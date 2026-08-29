import mongoose from 'mongoose';
import { ModelAgentSkill } from '../../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentSkill.schema';
import { BUILTIN_AGENT_SKILL_SEEDS } from '../agent/agentUtils/agentShell/agentShellEnvironmentContext';

let seedPromise: Promise<void> | null = null;

/** Idempotent seed of system builtin skills (userId null). Updates body/description when seeds change. */
export const ensureBuiltinAgentSkills = async (): Promise<void> => {
    if (!seedPromise) {
        seedPromise = (async () => {
            for (const seed of BUILTIN_AGENT_SKILL_SEEDS) {
                const existing = await ModelAgentSkill.findOne({
                    isBuiltin: true,
                    userId: null,
                    name: seed.name,
                }).select('_id description body');
                if (existing) {
                    const needsUpdate =
                        existing.description !== seed.description || existing.body !== seed.body;
                    if (needsUpdate) {
                        await ModelAgentSkill.updateOne(
                            { _id: existing._id },
                            {
                                $set: {
                                    description: seed.description,
                                    body: seed.body,
                                    enabled: true,
                                    updatedAtUtc: new Date(),
                                },
                            }
                        );
                    }
                    continue;
                }
                await ModelAgentSkill.create({
                    userId: null,
                    name: seed.name,
                    description: seed.description,
                    body: seed.body,
                    enabled: true,
                    isBuiltin: true,
                    createdAtUtc: new Date(),
                    updatedAtUtc: new Date(),
                });
            }
        })().catch((err) => {
            seedPromise = null;
            throw err;
        });
    }
    await seedPromise;
};

export type AgentSkillCatalogItem = {
    name: string;
    description: string;
};

export type AgentSkillBodyItem = {
    name: string;
    description: string;
    body: string;
};

/**
 * Enabled skills for a user: builtins + user-owned.
 * User skill with same name as builtin overrides the builtin for that user.
 */
export const listEnabledSkillsForUser = async (
    userId: mongoose.Types.ObjectId | string
): Promise<AgentSkillBodyItem[]> => {
    await ensureBuiltinAgentSkills();
    const uid = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    const [builtins, userSkills] = await Promise.all([
        ModelAgentSkill.find({ isBuiltin: true, userId: null, enabled: true })
            .select('name description body')
            .lean(),
        // All user skills (including disabled) so a disabled override can hide a builtin
        ModelAgentSkill.find({ userId: uid }).select('name description body enabled').lean(),
    ]);

    const byName = new Map<string, AgentSkillBodyItem>();
    for (const s of builtins) {
        byName.set(s.name, {
            name: s.name,
            description: s.description || '',
            body: s.body || '',
        });
    }
    for (const s of userSkills) {
        if (s.enabled === false) {
            byName.delete(s.name);
            continue;
        }
        byName.set(s.name, {
            name: s.name,
            description: s.description || '',
            body: s.body || '',
        });
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
};

export const listSkillsCatalogForUser = async (
    userId: mongoose.Types.ObjectId | string
): Promise<AgentSkillCatalogItem[]> => {
    const full = await listEnabledSkillsForUser(userId);
    return full.map((s) => ({ name: s.name, description: s.description }));
};

const MAX_SKILLS_LOAD = 3;
const MAX_SKILL_BODY_CHARS = 12_000;

export const resolveSkillsToLoad = (
    catalogBodies: AgentSkillBodyItem[],
    skillsToLoad: string[] | undefined
): AgentSkillBodyItem[] => {
    if (!Array.isArray(skillsToLoad) || skillsToLoad.length === 0) return [];
    const wanted = skillsToLoad
        .map((n) => String(n || '').trim().toLowerCase())
        .filter(Boolean)
        .slice(0, MAX_SKILLS_LOAD);
    const byName = new Map(catalogBodies.map((s) => [s.name.toLowerCase(), s]));
    const out: AgentSkillBodyItem[] = [];
    let budget = MAX_SKILL_BODY_CHARS;
    for (const name of wanted) {
        const skill = byName.get(name);
        if (!skill) continue;
        const body = skill.body.slice(0, Math.max(0, budget));
        if (!body && skill.body) continue;
        out.push({ ...skill, body: body || skill.body.slice(0, 500) });
        budget -= body.length;
        if (budget <= 0) break;
    }
    return out;
};

export const formatActiveSkillsBlock = (skills: AgentSkillBodyItem[]): string => {
    if (!skills.length) return '';
    return (
        'ACTIVE SKILLS (follow these instructions):\n\n' +
        skills.map((s) => `### Skill: ${s.name}\n${s.description}\n\n${s.body}`).join('\n\n---\n\n')
    ).slice(0, MAX_SKILL_BODY_CHARS + 2000);
};

export const normalizeSkillName = (raw: string): string =>
    String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 64);
