import { createHash } from "node:crypto";
import {
  constants,
  lstatSync,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const LIMIT = 64 * 1024;
const MARKER = "checkbox.addEventListener('change', update);";
const MUTATION =
  "checkbox.addEventListener('change', () => { checkbox.checked = false; update(); });";
const allowedKeys =
  /^(?:Enter|Escape|Tab|Arrow(?:Up|Down|Left|Right)|Page(?:Up|Down)|Home|End|Backspace|Delete|[A-Za-z0-9])$/;

function regularBytes(path, maxBytes = LIMIT) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes)
      throw new Error("web-reference-file-invalid");
    const bytes = readFileSync(fd);
    if (bytes.length > maxBytes) throw new Error("web-reference-file-invalid");
    return bytes;
  } finally {
    closeSync(fd);
  }
}

/** Narrow test-host driver. No remote navigation, user profile or production authority. */
export class ReferenceWebDriver {
  #server;
  #browser;
  #context;
  #page;
  #html;
  #root;
  #viewport;
  #serial = 0;
  #artifacts = new Map();
  #snapshots = new Map();
  #consoleErrors = [];
  #closed = false;
  #lease = {
    launched: false,
    pid: null,
    pagesOpened: 0,
    pagesClosed: 0,
    blockedRequests: 0,
    processExited: false,
  };

  constructor({ artifactRoot, viewport, mutation = false }) {
    if (
      typeof mutation !== "boolean" ||
      !viewport ||
      !Number.isInteger(viewport.width) ||
      !Number.isInteger(viewport.height) ||
      viewport.width < 320 ||
      viewport.width > 1920 ||
      viewport.height < 480 ||
      viewport.height > 1080
    ) {
      throw new Error("web-reference-options-invalid");
    }
    if (
      !lstatSync(artifactRoot).isDirectory() ||
      lstatSync(artifactRoot).isSymbolicLink()
    )
      throw new Error("web-reference-root-invalid");
    this.#root = realpathSync(artifactRoot);
    this.#viewport = { ...viewport };
    const source = regularBytes(new URL("./index.html", import.meta.url));
    this.baseSourceSha256 = hash(source);
    this.#html = source.toString("utf8");
    if (this.#html.split(MARKER).length !== 2)
      throw new Error("web-reference-mutation-marker-drift");
    if (mutation) this.#html = this.#html.replace(MARKER, MUTATION);
    this.sourceSha256 = hash(this.#html);
    this.mutation = mutation;
  }

  async launch() {
    if (this.#closed) throw new Error("web-reference-closed");
    if (this.#browser) return;
    // A new owned browser, with the native Chromium sandbox explicitly enabled.
    // The WS endpoint remains loopback and is never persisted or printed.
    this.#server = await chromium.launchServer({
      channel: "chrome",
      headless: true,
      chromiumSandbox: true,
      host: "127.0.0.1",
      timeout: 15_000,
    });
    this.#lease.pid = this.#server.process().pid;
    this.#lease.launched = true;
    this.#browser = await chromium.connect(this.#server.wsEndpoint(), {
      timeout: 10_000,
    });
    this.browserVersion = this.#browser.version();
  }

  async #freshPage() {
    await this.launch();
    if (this.#context) await this.#context.close();
    this.#context = await this.#browser.newContext({
      viewport: this.#viewport,
      deviceScaleFactor: 1,
      serviceWorkers: "block",
      acceptDownloads: false,
      permissions: [],
      offline: true,
    });
    await this.#context.route("**/*", async (route) => {
      this.#lease.blockedRequests += 1;
      await route.abort();
    });
    await this.#context.routeWebSocket("**/*", (socket) => socket.close());
    this.#page = await this.#context.newPage();
    this.#lease.pagesOpened += 1;
    this.#page.once("close", () => {
      this.#lease.pagesClosed += 1;
    });
    this.#page.setDefaultTimeout(3000);
    this.#page.setDefaultNavigationTimeout(3000);
    this.#consoleErrors = [];
    this.#page.on("pageerror", () => {
      if (this.#consoleErrors.length < 16)
        this.#consoleErrors.push({
          level: "error",
          message: "reference-page-error",
        });
    });
    this.#page.on("console", (message) => {
      if (message.type() === "error" && this.#consoleErrors.length < 16)
        this.#consoleErrors.push({
          level: "error",
          message: "reference-console-error",
        });
    });
    this.#page.on("dialog", (dialog) => dialog.dismiss());
    this.#page.on("download", (download) => download.cancel());
    await this.#page.setContent(this.#html, {
      waitUntil: "load",
      timeout: 3000,
    });
  }

  async #ready() {
    if (this.#closed) throw new Error("web-reference-closed");
    if (!this.#page) await this.#freshPage();
    return this.#page;
  }

  async #state() {
    const page = await this.#ready();
    // Read actual DOM state. Never set outcome values or query application internals.
    return page.evaluate(() => {
      const list = [...document.querySelectorAll("#tasks li")].map((item) => ({
        text: item.querySelector("span").textContent,
        completed: item.querySelector("input").checked,
      }));
      return {
        items: list,
        count: list.length,
        completed: list.filter((item) => item.completed).length,
        input: document.querySelector("#task-name").value,
        summary: document.querySelector("#summary").textContent,
        validation: document.querySelector("#validation").textContent,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
  }

  async observe() {
    const page = await this.#ready();
    const state = await this.#state();
    const aria = await page.locator("body").ariaSnapshot();
    if (aria.length > LIMIT || JSON.stringify(state).length > LIMIT)
      throw new Error("web-reference-state-limit");
    return {
      accessibility: { ...state, aria },
      viewport: { ...this.#viewport, deviceScaleFactor: 1 },
      console: [...this.#consoleErrors],
      network: [],
    };
  }

  async navigate() {
    throw new Error("web-navigation-disabled-local-reference");
  }

  async click(target) {
    if (
      !target ||
      !["button", "checkbox"].includes(target.role) ||
      typeof target.name !== "string" ||
      target.name.length > 100 ||
      Object.keys(target).sort().join(",") !== "name,role"
    )
      throw new Error("web-reference-target-invalid");
    await (
      await this.#ready()
    )
      .getByRole(target.role, { name: target.name, exact: true })
      .click();
  }

  async fill(target, value) {
    if (
      !target ||
      target.role !== "textbox" ||
      target.name !== "Task name" ||
      Object.keys(target).sort().join(",") !== "name,role" ||
      typeof value !== "string" ||
      value.length > 80
    )
      throw new Error("web-reference-target-invalid");
    await (
      await this.#ready()
    )
      .getByRole("textbox", { name: "Task name", exact: true })
      .fill(value);
  }

  async press(key) {
    if (typeof key !== "string" || !allowedKeys.test(key))
      throw new Error("web-reference-key-invalid");
    await (await this.#ready()).keyboard.press(key);
  }

  async scroll(deltaY) {
    if (!Number.isFinite(deltaY) || Math.abs(deltaY) > 10_000)
      throw new Error("web-reference-scroll-invalid");
    await (await this.#ready()).mouse.wheel(0, deltaY);
  }

  async reset() {
    await this.#freshPage();
    return this.observe();
  }

  #write(kind, bytes, mediaType) {
    if (this.#artifacts.size >= 128 || bytes.length > 4 * 1024 * 1024)
      throw new Error("web-reference-artifact-limit");
    const ref = `${kind}-${++this.#serial}.${mediaType === "image/png" ? "png" : "json"}`;
    writeFileSync(join(this.#root, ref), bytes, { flag: "wx", mode: 0o600 });
    const record = Object.freeze({
      ref,
      bytes: bytes.length,
      sha256: hash(bytes),
      mediaType,
    });
    this.#artifacts.set(ref, record);
    return record;
  }

  async collectEvidence() {
    const semantic = await this.observe();
    const page = await this.#ready();
    const png = await page.screenshot({
      type: "png",
      animations: "disabled",
      timeout: 3000,
    });
    return {
      artifacts: [
        this.#write("screen", png, "image/png"),
        this.#write(
          "state",
          Buffer.from(JSON.stringify(semantic)),
          "application/json",
        ),
      ],
      console: [...this.#consoleErrors],
      network: [],
    };
  }

  async snapshot() {
    if (this.#snapshots.size >= 16)
      throw new Error("web-reference-snapshot-limit");
    const state = await this.#state();
    const body = Buffer.from(
      JSON.stringify({ sourceSha256: this.sourceSha256, state }),
    );
    const artifact = this.#write("snapshot", body, "application/json");
    const record = Object.freeze({
      ref: artifact.ref,
      bytes: artifact.bytes,
      mediaType: artifact.mediaType,
      stateSha256: artifact.sha256,
      snapshotId: `snapshot-${this.#serial}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    this.#snapshots.set(record.snapshotId, {
      record,
      state: structuredClone(state),
      used: false,
    });
    return record;
  }

  async restore(snapshot) {
    const stored = this.#snapshots.get(snapshot?.snapshotId);
    if (
      !stored ||
      stored.used ||
      Date.now() >= Date.parse(stored.record.expiresAt) ||
      JSON.stringify(snapshot) !== JSON.stringify(stored.record)
    )
      throw new Error("web-reference-snapshot-invalid");
    const bytes = regularBytes(join(this.#root, stored.record.ref));
    if (
      bytes.length !== stored.record.bytes ||
      hash(bytes) !== stored.record.stateSha256
    )
      throw new Error("web-reference-snapshot-invalid");
    stored.used = true;
    await this.#freshPage();
    for (const item of stored.state.items) {
      await this.fill({ role: "textbox", name: "Task name" }, item.text);
      await this.click({ role: "button", name: "Add task" });
      if (item.completed)
        await this.click({ role: "checkbox", name: `Complete ${item.text}` });
    }
    await this.fill({ role: "textbox", name: "Task name" }, stored.state.input);
    if (JSON.stringify(await this.#state()) !== JSON.stringify(stored.state))
      throw new Error("web-reference-restore-mismatch");
    return this.observe();
  }

  async close() {
    if (this.#closed) return this.lease();
    this.#closed = true;
    try {
      if (this.#context) await this.#context.close();
    } finally {
      try {
        if (this.#browser) await this.#browser.close();
      } finally {
        if (this.#server) await this.#server.close();
        if (this.#lease.pid) {
          try {
            process.kill(this.#lease.pid, 0);
          } catch (error) {
            if (error.code === "ESRCH") this.#lease.processExited = true;
            else throw error;
          }
        }
      }
    }
    if (
      this.#lease.launched &&
      (!this.#lease.processExited ||
        this.#lease.pagesOpened !== this.#lease.pagesClosed)
    )
      throw new Error("web-reference-cleanup-unconfirmed");
    return this.lease();
  }

  lease() {
    return {
      ...this.#lease,
      closed: this.#closed,
      externalNavigation: "disabled",
      profile: "owned-ephemeral",
      transport: "offline-set-content",
      productionEligible: false,
    };
  }
}
