/**
 * 技能管理
 *
 * 负责技能的发现（从多个路径扫描 SKILL.md）、元数据读取、去重、匹配。
 * 从 session.ts 拆分。
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import matter from "gray-matter";
import type { SkillInfo } from "./session-types";
import type { CreateOpenAIClient } from "./tools/executor";
import type { SessionStorage } from "./session-storage";

// ─── SessionSkills ───────────────────────────────────────

export class SessionSkills {
  private readonly projectRoot: string;
  private readonly storage: SessionStorage;
  private readonly createClient: CreateOpenAIClient;

  constructor(projectRoot: string, storage: SessionStorage, createClient: CreateOpenAIClient) {
    this.projectRoot = projectRoot;
    this.storage = storage;
    this.createClient = createClient;
  }

  // ─── 技能发现 ──────────────────────────────────────────

  async listSkills(sessionId?: string): Promise<SkillInfo[]> {
    const homeDir = os.homedir();
    const agentsRoot = path.join(homeDir, ".agents", "skills");
    const legacyProjectSkillsRoot = path.join(this.projectRoot, ".deepcode", "skills");
    const projectAgentsSkillsRoot = path.join(this.projectRoot, ".agents", "skills");
    const skillsByName = new Map<string, SkillInfo>();

    const collectSkills = (root: string, displayRoot: string): SkillInfo[] => {
      if (!fs.existsSync(root)) {
        return [];
      }
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        return [];
      }

      const results: SkillInfo[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) {
          continue;
        }
        const skillName = entry.name;
        const skillPath = path.join(root, skillName, "SKILL.md");
        try {
          if (!fs.existsSync(skillPath)) {
            continue;
          }
          const stat = fs.statSync(skillPath);
          if (!stat.isFile()) {
            continue;
          }
        } catch {
          continue;
        }
        results.push(this.readSkillInfo(skillPath, `${displayRoot}/${skillName}/SKILL.md`, skillName));
      }
      return results;
    };

    for (const skill of collectSkills(agentsRoot, "~/.agents/skills")) {
      skillsByName.set(skill.name, skill);
    }
    for (const skill of collectSkills(legacyProjectSkillsRoot, "./.deepcode/skills")) {
      skillsByName.set(skill.name, skill);
    }
    for (const skill of collectSkills(projectAgentsSkillsRoot, "./.agents/skills")) {
      skillsByName.set(skill.name, skill);
    }

    if (sessionId) {
      const loadedSkillKeys = this.getLoadedSkillKeys(sessionId);
      for (const skill of skillsByName.values()) {
        if (loadedSkillKeys.has(this.getSkillKey(skill)) || loadedSkillKeys.has(this.getSkillKeyByName(skill.name))) {
          skill.isLoaded = true;
        }
      }
    }

    return Array.from(skillsByName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  // ─── Skill 路径解析 ────────────────────────────────────

  resolveSkillPath(skillPath: string): string {
    if (skillPath.startsWith("~/")) {
      return path.join(os.homedir(), skillPath.slice(2));
    }
    if (skillPath.startsWith("~\\")) {
      return path.join(os.homedir(), skillPath.slice(2));
    }
    if (skillPath.startsWith("./")) {
      return path.join(this.projectRoot, skillPath.slice(2));
    }
    if (skillPath.startsWith(".\\")) {
      return path.join(this.projectRoot, skillPath.slice(2));
    }
    if (path.isAbsolute(skillPath)) {
      return skillPath;
    }
    return path.join(os.homedir(), skillPath);
  }

  // ─── Skill 元数据读取 ──────────────────────────────────

  private readSkillInfo(skillPath: string, displayPath: string, fallbackName: string): SkillInfo {
    const fallbackSkill: SkillInfo = {
      name: fallbackName.replace(/_/g, "-"),
      path: displayPath,
      description: "",
    };

    try {
      const skillMd = fs.readFileSync(skillPath, "utf8");
      const parsed = matter(skillMd);
      return {
        name:
          typeof parsed.data.name === "string" && parsed.data.name.trim()
            ? parsed.data.name.trim()
            : fallbackSkill.name,
        path: displayPath,
        description: typeof parsed.data.description === "string" ? parsed.data.description.trim() : "",
      };
    } catch {
      return fallbackSkill;
    }
  }

  // ─── 技能键管理 ────────────────────────────────────────

  private getSkillKey(skill: Pick<SkillInfo, "path">): string {
    return `path:${skill.path}`;
  }

  private getSkillKeyByName(name: string): string {
    return `name:${name}`;
  }

  private getLoadedSkillKeys(sessionId: string): Set<string> {
    const loadedSkillKeys = new Set<string>();
    for (const message of this.storage.listSessionMessages(sessionId)) {
      if (message.role !== "system" || !message.meta?.skill) {
        continue;
      }
      loadedSkillKeys.add(this.getSkillKey(message.meta.skill));
      loadedSkillKeys.add(this.getSkillKeyByName(message.meta.skill.name));
    }
    return loadedSkillKeys;
  }

  // ─── 去重 ──────────────────────────────────────────────

  dedupeSkills(skills?: SkillInfo[]): SkillInfo[] | undefined {
    if (!skills || skills.length === 0) {
      return undefined;
    }

    const dedupedSkills = new Map<string, SkillInfo>();
    for (const skill of skills) {
      if (!skill?.name || !skill?.path) {
        continue;
      }
      const key = this.getSkillKey(skill);
      const existingSkill = dedupedSkills.get(key);
      dedupedSkills.set(key, {
        ...existingSkill,
        ...skill,
        description: skill.description ?? existingSkill?.description ?? "",
        isLoaded: Boolean(existingSkill?.isLoaded || skill.isLoaded),
      });
    }

    return Array.from(dedupedSkills.values());
  }

  async normalizeSkills(skills?: SkillInfo[], sessionId?: string): Promise<SkillInfo[] | undefined> {
    const dedupedSkills = this.dedupeSkills(skills);
    if (!dedupedSkills || dedupedSkills.length === 0) {
      return undefined;
    }

    const availableSkills = await this.listSkills(sessionId);
    const availableSkillsByKey = new Map<string, SkillInfo>();
    for (const skill of availableSkills) {
      availableSkillsByKey.set(this.getSkillKey(skill), skill);
      availableSkillsByKey.set(this.getSkillKeyByName(skill.name), skill);
    }

    return dedupedSkills.map((skill) => {
      const matchedSkill =
        availableSkillsByKey.get(this.getSkillKey(skill)) ??
        availableSkillsByKey.get(this.getSkillKeyByName(skill.name));
      if (!matchedSkill) {
        return skill;
      }
      return {
        ...matchedSkill,
        ...skill,
        description: matchedSkill.description || skill.description,
        isLoaded: Boolean(matchedSkill.isLoaded || skill.isLoaded),
      };
    });
  }

  // ─── LLM 辅助技能匹配 ─────────────────────────────────

  async identifyMatchingSkillNames(
    skills: SkillInfo[],
    userPrompt: string,
    options?: { signal?: AbortSignal; sessionId?: string }
  ): Promise<string[]> {
    if (options?.signal?.aborted) {
      return [];
    }

    const simpleSkills = skills.filter((x) => !x.isLoaded).map((x) => ({ name: x.name, description: x.description }));
    if (simpleSkills.length === 0) {
      return [];
    }

    let systemPrompt = `When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.\n
Response in JSON format:
\`\`\`
{
  "skillNames": ["", ...]
}
\`\`\`\n
If none of the available skills match, respond with an empty array, i.e. \`{"skillNames": []}\`.\n
The candidate skills are as follows:\n\n`;
    systemPrompt += "```\n" + JSON.stringify(simpleSkills, null, 2) + "\n```";

    const { client, model, baseURL, debugLogEnabled } = this.createClient();
    if (!client) {
      return [];
    }

    // We need a simple completion call here; the caller should pass a stream-capable client.
    // For simplicity, we re-use the same pattern as the original code but decoupled.
    try {
      const response = await (
        client.chat.completions.create as unknown as (
          body: Record<string, unknown>,
          options?: Record<string, unknown>
        ) => Promise<unknown>
      )(
        {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
        },
        options?.signal ? { signal: options.signal } : undefined
      );

      if (options?.signal?.aborted) {
        return [];
      }

      const responseObj = response as { choices?: Array<{ message?: { content?: unknown } }> };
      const rawContent = responseObj.choices?.[0]?.message?.content;
      const content = typeof rawContent === "string" ? rawContent : "";
      if (!content) {
        return [];
      }

      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.skillNames)) {
        return parsed.skillNames;
      }

      return [];
    } catch {
      return [];
    }
  }
}
