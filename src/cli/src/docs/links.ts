import { posix } from "node:path";
import type {
  DocsCatalog,
  DocsDiagnostic,
  DocsDocument,
  DocsRelation,
} from "./types.js";

function splitTarget(target: string): {
  path: string;
  anchor: string | undefined;
} {
  const hashIndex = target.indexOf("#");
  if (hashIndex < 0) return { path: target, anchor: undefined };
  return {
    path: target.slice(0, hashIndex),
    anchor: decodeURIComponent(target.slice(hashIndex + 1)),
  };
}

function resolveRelativePath(from: string, target: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return null;
  }
  if (decoded.startsWith("/") || /^[A-Za-z]:[\\/]/.test(decoded)) {
    return null;
  }
  const stack = posix
    .dirname(from)
    .split("/")
    .filter((segment) => Boolean(segment) && segment !== ".");
  for (const segment of decoded.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return null;
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  return stack.join("/");
}

function relativeRoute(fromRoute: string, targetRoute: string): string {
  const relative = posix.relative(posix.dirname(fromRoute), targetRoute);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function addDiagnostic(
  catalog: DocsCatalog,
  document: DocsDocument,
  diagnostic: Omit<DocsDiagnostic, "projectId" | "path">,
): void {
  catalog.diagnostics.push({
    ...diagnostic,
    projectId: document.projectId,
    path: document.sourcePath,
  });
}

function candidateDocumentPaths(path: string): string[] {
  const candidates = [path];
  if (!/\.(?:md|markdown|json|ya?ml)$/i.test(path)) {
    candidates.push(
      `${path}.md`,
      `${path}.markdown`,
      posix.join(path, "README.md"),
    );
  }
  return candidates;
}

export function resolveCatalogLinks(catalogs: DocsCatalog[]): DocsCatalog[] {
  const documentsByProject = new Map<string, Map<string, DocsDocument>>();
  const assetsByProject = new Map<
    string,
    Map<string, DocsCatalog["assets"][number]>
  >();
  for (const catalog of catalogs) {
    documentsByProject.set(
      catalog.project.id,
      new Map(
        catalog.documents.map((document) => [document.sourcePath, document]),
      ),
    );
    assetsByProject.set(
      catalog.project.id,
      new Map(catalog.assets.map((asset) => [asset.sourcePath, asset])),
    );
    catalog.relations = catalog.relations.filter(
      (relation) => relation.type === "code-ref" || relation.type === "truth",
    );
    for (const document of catalog.documents) {
      document.backlinks = [];
      document.related = [];
      for (const link of document.links) {
        delete link.resolvedDocumentId;
        delete link.resolvedAssetId;
        delete link.resolvedRoute;
      }
    }
    catalog.diagnostics = catalog.diagnostics.filter(
      (diagnostic) =>
        ![
          "BROKEN_LINK",
          "BROKEN_ASSET",
          "BROKEN_ANCHOR",
          "LINK_TRAVERSAL",
          "LINK_CASE_MISMATCH",
          "UNKNOWN_PROJECT_LINK",
        ].includes(diagnostic.code),
    );
  }

  for (const catalog of catalogs) {
    const exactDocs = documentsByProject.get(catalog.project.id) ?? new Map();
    const exactAssets = assetsByProject.get(catalog.project.id) ?? new Map();
    const caseDocs = new Map(
      [...exactDocs.entries()].map(([path, document]) => [
        path.toLowerCase(),
        document,
      ]),
    );
    const caseAssets = new Map(
      [...exactAssets.entries()].map(([path, asset]) => [
        path.toLowerCase(),
        asset,
      ]),
    );

    for (const document of catalog.documents) {
      for (const codeRef of document.codeRefs) {
        catalog.relations.push({
          from: document.id,
          to: codeRef,
          type: "code-ref",
          source: document.sourcePath,
          confidence: codeRef.startsWith("gitnexus://") ? 1 : 0.75,
        });
      }
      if (document.sourceOfTruth) {
        catalog.relations.push({
          from: catalog.project.id,
          to: document.id,
          type: "truth",
          source: "docs-manifest",
          confidence: 1,
        });
      }

      for (const link of document.links) {
        if (link.kind === "external") continue;
        if (link.kind === "anchor") {
          const anchor = link.target.slice(1);
          link.anchor = anchor;
          if (!document.headings.some((heading) => heading.slug === anchor)) {
            addDiagnostic(catalog, document, {
              severity: "warning",
              code: "BROKEN_ANCHOR",
              message: `Heading anchor "#${anchor}" does not exist (line ${link.line}).`,
              suggestion:
                "Update the anchor to match a generated heading slug.",
            });
          } else {
            link.resolvedRoute = `#${anchor}`;
          }
          continue;
        }

        let targetProjectId = catalog.project.id;
        let rawTarget = link.target;
        if (rawTarget.startsWith("forgewright://")) {
          try {
            const url = new URL(rawTarget);
            targetProjectId = url.hostname;
            rawTarget = url.pathname.replace(/^\/+/, "") + url.hash;
          } catch {
            addDiagnostic(catalog, document, {
              severity: "error",
              code: "BROKEN_LINK",
              message: `Invalid cross-project link "${link.target}" (line ${link.line}).`,
            });
            continue;
          }
        }

        const targetDocs = documentsByProject.get(targetProjectId);
        const targetAssets = assetsByProject.get(targetProjectId);
        if (!targetDocs || !targetAssets) {
          addDiagnostic(catalog, document, {
            severity: "warning",
            code: "UNKNOWN_PROJECT_LINK",
            message: `Cross-project target "${targetProjectId}" is not part of this build.`,
            suggestion: "Register and build the target project together.",
          });
          continue;
        }

        const split = splitTarget(rawTarget);
        const resolvedPath =
          targetProjectId === catalog.project.id
            ? resolveRelativePath(document.sourcePath, split.path)
            : split.path.replace(/^\/+/, "");
        if (resolvedPath === null) {
          addDiagnostic(catalog, document, {
            severity: "error",
            code: "LINK_TRAVERSAL",
            message: `Link escapes the project root: "${link.target}" (line ${link.line}).`,
            suggestion:
              "Use a contained relative link or a forgewright:// project link.",
          });
          continue;
        }

        const docCandidates = candidateDocumentPaths(resolvedPath);
        const resolvedDocument = docCandidates
          .map((candidate) => targetDocs.get(candidate))
          .find((candidate) => candidate !== undefined);
        const resolvedAsset = targetAssets.get(resolvedPath);

        if (resolvedDocument) {
          link.kind = "document";
          link.anchor = split.anchor;
          link.resolvedDocumentId = resolvedDocument.id;
          link.resolvedRoute = `${relativeRoute(document.route, resolvedDocument.route)}${split.anchor ? `#${split.anchor}` : ""}`;
          catalog.relations.push({
            from: document.id,
            to: resolvedDocument.id,
            type: "links-to",
            source: document.sourcePath,
            confidence: 1,
          });
          resolvedDocument.backlinks.push(document.id);
          if (
            split.anchor &&
            !resolvedDocument.headings.some(
              (heading) => heading.slug === split.anchor,
            )
          ) {
            addDiagnostic(catalog, document, {
              severity: "warning",
              code: "BROKEN_ANCHOR",
              message: `Anchor "#${split.anchor}" does not exist in ${resolvedDocument.sourcePath}.`,
            });
          }
          continue;
        }

        if (resolvedAsset) {
          link.kind = "asset";
          link.resolvedAssetId = resolvedAsset.id;
          link.resolvedRoute = relativeRoute(
            document.route,
            resolvedAsset.route,
          );
          catalog.relations.push({
            from: document.id,
            to: resolvedAsset.id,
            type: "embeds",
            source: document.sourcePath,
            confidence: 1,
          });
          continue;
        }

        const mismatchedDocument = docCandidates
          .map((candidate) => caseDocs.get(candidate.toLowerCase()))
          .find((candidate) => candidate !== undefined);
        const mismatchedAsset = caseAssets.get(resolvedPath.toLowerCase());
        if (
          targetProjectId === catalog.project.id &&
          (mismatchedDocument || mismatchedAsset)
        ) {
          const actual =
            mismatchedDocument?.sourcePath ?? mismatchedAsset?.sourcePath ?? "";
          addDiagnostic(catalog, document, {
            severity: "warning",
            code: "LINK_CASE_MISMATCH",
            message: `Link casing differs from "${actual}" (line ${link.line}).`,
            suggestion:
              "Match the source path casing for cross-platform builds.",
          });
          continue;
        }

        addDiagnostic(catalog, document, {
          severity: "warning",
          code: link.image ? "BROKEN_ASSET" : "BROKEN_LINK",
          message: `Unresolved ${link.image ? "asset" : "link"} "${link.target}" (line ${link.line}).`,
          suggestion: `Create the target ${link.image ? "asset" : "document"} or update the relative path.`,
        });
      }
    }
  }

  const allDocuments = new Map(
    catalogs.flatMap((catalog) =>
      catalog.documents.map((document) => [document.id, document] as const),
    ),
  );
  for (const catalog of catalogs) {
    for (const document of catalog.documents) {
      document.backlinks = [...new Set(document.backlinks)].sort();
      const relatedScores = new Map<string, number>();
      for (const other of allDocuments.values()) {
        if (other.id === document.id) continue;
        const sharedTags = document.tags.filter((tag) =>
          other.tags.includes(tag),
        ).length;
        const direct =
          document.links.some((link) => link.resolvedDocumentId === other.id) ||
          document.backlinks.includes(other.id);
        const score = sharedTags * 2 + (direct ? 3 : 0);
        if (score > 0) relatedScores.set(other.id, score);
      }
      document.related = [...relatedScores.entries()]
        .sort(
          (left, right) =>
            right[1] - left[1] || left[0].localeCompare(right[0]),
        )
        .slice(0, 6)
        .map(([id]) => id);
      for (const relatedId of document.related) {
        const relation: DocsRelation = {
          from: document.id,
          to: relatedId,
          type: "related",
          source: "derived",
          confidence: Math.min(
            0.95,
            0.5 + (relatedScores.get(relatedId) ?? 0) * 0.1,
          ),
        };
        catalog.relations.push(relation);
      }
    }
  }

  return catalogs;
}
