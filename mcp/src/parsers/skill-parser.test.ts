import fs from 'fs';
import os from 'os';
import { basename, join } from 'path';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { getAllSkills, getSharedProtocols, _setRootOverride } from './skill-parser.js';

const fixtureRoots: string[] = [];

function createFixture(): { root: string; skillsDir: string; outsideDir: string } {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'forgewright-skill-parser-'));
  const skillsDir = join(root, 'project', 'skills');
  const outsideDir = join(root, 'outside');
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  fixtureRoots.push(root);
  return { root: join(root, 'project'), skillsDir, outsideDir };
}

afterEach(() => {
  vi.restoreAllMocks();
  _setRootOverride('/nonexistent');
  for (const root of fixtureRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Skill Parser', () => {
  describe('getSharedProtocols', () => {
    it('returns empty array when protocols dir missing', () => {
      _setRootOverride('/nonexistent');
      const protocols = getSharedProtocols();
      expect(protocols).toEqual([]);
    });
  });

  describe('getAllSkills', () => {
    it('returns empty array when skills dir missing', () => {
      _setRootOverride('/nonexistent');
      const skills = getAllSkills();
      expect(skills).toEqual([]);
    });

    it('rejects a symlinked skills root without reading external skills', () => {
      const { root, skillsDir, outsideDir } = createFixture();
      const externalSkillsDir = join(outsideDir, 'skills');
      fs.mkdirSync(externalSkillsDir);
      fs.writeFileSync(join(externalSkillsDir, 'SKILL.md'), 'external skill');
      fs.rmSync(skillsDir, { recursive: true, force: true });
      fs.symlinkSync(externalSkillsDir, skillsDir, 'dir');
      _setRootOverride(root);

      const readFileSpy = vi.spyOn(fs, 'readFileSync');
      expect(getAllSkills()).toEqual([]);
      expect(
        readFileSpy.mock.calls.some(([filePath]) => filePath.toString().startsWith(outsideDir)),
      ).toBe(false);
    });

    it('skips a broken skills root symlink safely', () => {
      const { root, skillsDir, outsideDir } = createFixture();
      fs.rmSync(skillsDir, { recursive: true, force: true });
      fs.symlinkSync(join(outsideDir, 'missing-skills'), skillsDir, 'dir');
      _setRootOverride(root);

      expect(() => getAllSkills()).not.toThrow();
      expect(getAllSkills()).toEqual([]);
    });

    it('does not read shared protocols through a symlinked skills root', () => {
      const { root, skillsDir, outsideDir } = createFixture();
      const externalSkillsDir = join(outsideDir, 'skills-root');
      const externalProtocolsDir = join(externalSkillsDir, '_shared', 'protocols');
      fs.mkdirSync(externalProtocolsDir, { recursive: true });
      const externalProtocol = join(externalProtocolsDir, 'external.md');
      fs.writeFileSync(externalProtocol, 'external protocol');
      fs.rmSync(skillsDir, { recursive: true, force: true });
      fs.symlinkSync(externalSkillsDir, skillsDir, 'dir');
      _setRootOverride(root);

      const readFileSpy = vi.spyOn(fs, 'readFileSync');
      expect(getSharedProtocols()).toEqual([]);
      expect(
        readFileSpy.mock.calls.some(([filePath]) => filePath.toString() === externalProtocol),
      ).toBe(false);
    });

    it('does not traverse symlinked skill directories', () => {
      const { root, skillsDir, outsideDir } = createFixture();
      const outsideSkillDir = join(outsideDir, 'escaped');
      fs.mkdirSync(outsideSkillDir);
      fs.writeFileSync(join(outsideSkillDir, 'SKILL.md'), 'outside directory skill');
      fs.symlinkSync(outsideSkillDir, join(skillsDir, 'escaped'), 'dir');
      _setRootOverride(root);

      const readFileSpy = vi.spyOn(fs, 'readFileSync');
      expect(getAllSkills()).toEqual([]);
      expect(
        readFileSpy.mock.calls.some(([filePath]) => filePath.toString().startsWith(outsideDir)),
      ).toBe(false);
    });

    it('does not accept symlinked SKILL.md files', () => {
      const { root, skillsDir, outsideDir } = createFixture();
      const linkedSkillDir = join(skillsDir, 'linked-file');
      const outsideSkill = join(outsideDir, 'SKILL.md');
      fs.mkdirSync(linkedSkillDir);
      fs.writeFileSync(outsideSkill, 'outside file skill');
      fs.symlinkSync(outsideSkill, join(linkedSkillDir, 'SKILL.md'));
      _setRootOverride(root);

      const readFileSpy = vi.spyOn(fs, 'readFileSync');
      expect(getAllSkills()).toEqual([]);
      expect(
        readFileSpy.mock.calls.some(([filePath]) => filePath.toString() === outsideSkill),
      ).toBe(false);
    });

    it('skips broken SKILL.md symlinks safely', () => {
      const { root, skillsDir, outsideDir } = createFixture();
      const brokenSkillDir = join(skillsDir, 'broken');
      fs.mkdirSync(brokenSkillDir);
      fs.symlinkSync(join(outsideDir, 'missing', 'SKILL.md'), join(brokenSkillDir, 'SKILL.md'));
      _setRootOverride(root);

      expect(() => getAllSkills()).not.toThrow();
      expect(getAllSkills()).toEqual([]);
    });

    it('discovers skills in nested real directories', () => {
      const { root, skillsDir } = createFixture();
      const nestedSkill = join(skillsDir, 'group', 'nested-skill', 'SKILL.md');
      fs.mkdirSync(join(skillsDir, 'group', 'nested-skill'), { recursive: true });
      fs.writeFileSync(nestedSkill, 'nested skill');
      _setRootOverride(root);

      expect(getAllSkills()).toMatchObject([
        {
          name: basename(join(skillsDir, 'group', 'nested-skill')),
          content: 'nested skill',
          filePath: fs.realpathSync(nestedSkill),
        },
      ]);
    });
  });
});
