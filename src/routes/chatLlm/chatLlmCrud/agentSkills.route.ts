import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';

import middlewareUserAuth from '../../../middleware/middlewareUserAuth';
import { ModelAgentSkill } from '../../../schema/schemaChatLlm/SchemaAgent/SchemaAgentSkill.schema';
import {
    ensureBuiltinAgentSkills,
    normalizeSkillName,
} from './agent/agentSkillsLib';

const router = Router();

const serializeSkill = (doc: {
    _id: mongoose.Types.ObjectId;
    userId?: mongoose.Types.ObjectId | null;
    name: string;
    description: string;
    body: string;
    enabled: boolean;
    isBuiltin: boolean;
    createdAtUtc?: Date;
    updatedAtUtc?: Date;
}) => ({
    id: String(doc._id),
    userId: doc.userId ? String(doc.userId) : null,
    name: doc.name,
    description: doc.description,
    body: doc.body,
    enabled: Boolean(doc.enabled),
    isBuiltin: Boolean(doc.isBuiltin),
    createdAtUtc: doc.createdAtUtc || null,
    updatedAtUtc: doc.updatedAtUtc || null,
});

/** List merged skills for UI: user overrides replace builtins of the same name */
router.get('/', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        await ensureBuiltinAgentSkills();

        const [builtins, userSkills] = await Promise.all([
            ModelAgentSkill.find({ isBuiltin: true, userId: null }).sort({ name: 1 }).lean(),
            ModelAgentSkill.find({ userId }).sort({ name: 1 }).lean(),
        ]);

        const byName = new Map<string, ReturnType<typeof serializeSkill> & { isUserOverride?: boolean }>();
        for (const s of builtins) {
            byName.set(s.name, { ...serializeSkill(s), isUserOverride: false });
        }
        for (const s of userSkills) {
            const prev = byName.get(s.name);
            byName.set(s.name, {
                ...serializeSkill(s),
                isUserOverride: Boolean(prev?.isBuiltin),
            });
        }

        const skills = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));

        return res.status(200).json({
            success: true,
            skills,
        });
    } catch (error) {
        console.error('agent-skills list error:', error);
        return res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : 'Server error',
        });
    }
});

router.get('/:id', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        await ensureBuiltinAgentSkills();

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid id' });
        }

        const skill = await ModelAgentSkill.findById(req.params.id).lean();
        if (!skill) {
            return res.status(404).json({ success: false, message: 'Skill not found' });
        }

        const isOwner = skill.userId && String(skill.userId) === String(userId);
        const isBuiltin = skill.isBuiltin && !skill.userId;
        if (!isOwner && !isBuiltin) {
            return res.status(404).json({ success: false, message: 'Skill not found' });
        }

        return res.status(200).json({ success: true, skill: serializeSkill(skill) });
    } catch (error) {
        console.error('agent-skills get error:', error);
        return res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : 'Server error',
        });
    }
});

router.post('/', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        const name = normalizeSkillName(typeof req.body.name === 'string' ? req.body.name : '');
        const description = typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 1024) : '';
        const body = typeof req.body.body === 'string' ? req.body.body.slice(0, 50_000) : '';

        if (!name || name.length < 2) {
            return res.status(400).json({ success: false, message: 'name must be a valid slug (min 2 chars)' });
        }
        if (!description) {
            return res.status(400).json({ success: false, message: 'description is required' });
        }
        if (!body.trim()) {
            return res.status(400).json({ success: false, message: 'body is required' });
        }

        const existing = await ModelAgentSkill.findOne({ userId, name }).select('_id');
        if (existing) {
            return res.status(409).json({ success: false, message: 'A skill with this name already exists' });
        }

        const created = await ModelAgentSkill.create({
            userId,
            name,
            description,
            body,
            enabled: req.body.enabled !== false,
            isBuiltin: false,
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });

        return res.status(201).json({ success: true, skill: serializeSkill(created) });
    } catch (error) {
        console.error('agent-skills create error:', error);
        return res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : 'Server error',
        });
    }
});

router.put('/:id', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid id' });
        }

        const skill = await ModelAgentSkill.findById(req.params.id);
        if (!skill) {
            return res.status(404).json({ success: false, message: 'Skill not found' });
        }

        // Builtin system skills: duplicate into user skill instead of mutating
        if (skill.isBuiltin && !skill.userId) {
            const name = normalizeSkillName(
                typeof req.body.name === 'string' ? req.body.name : skill.name
            );
            const description =
                typeof req.body.description === 'string'
                    ? req.body.description.trim().slice(0, 1024)
                    : skill.description;
            const body = typeof req.body.body === 'string' ? req.body.body.slice(0, 50_000) : skill.body;

            let userCopy = await ModelAgentSkill.findOne({ userId, name });
            if (userCopy) {
                userCopy.description = description;
                userCopy.body = body;
                if (typeof req.body.enabled === 'boolean') userCopy.enabled = req.body.enabled;
                userCopy.updatedAtUtc = new Date();
                await userCopy.save();
                return res.status(200).json({
                    success: true,
                    skill: serializeSkill(userCopy),
                    duplicatedFromBuiltin: true,
                });
            }

            userCopy = await ModelAgentSkill.create({
                userId,
                name,
                description,
                body,
                enabled: typeof req.body.enabled === 'boolean' ? req.body.enabled : true,
                isBuiltin: false,
                createdAtUtc: new Date(),
                updatedAtUtc: new Date(),
            });
            return res.status(200).json({
                success: true,
                skill: serializeSkill(userCopy),
                duplicatedFromBuiltin: true,
            });
        }

        if (!skill.userId || String(skill.userId) !== String(userId)) {
            return res.status(404).json({ success: false, message: 'Skill not found' });
        }

        if (typeof req.body.name === 'string') {
            const name = normalizeSkillName(req.body.name);
            if (!name || name.length < 2) {
                return res.status(400).json({ success: false, message: 'Invalid name' });
            }
            if (name !== skill.name) {
                const clash = await ModelAgentSkill.findOne({ userId, name }).select('_id');
                if (clash) {
                    return res.status(409).json({ success: false, message: 'Name already in use' });
                }
                skill.name = name;
            }
        }
        if (typeof req.body.description === 'string') {
            const description = req.body.description.trim().slice(0, 1024);
            if (!description) {
                return res.status(400).json({ success: false, message: 'description is required' });
            }
            skill.description = description;
        }
        if (typeof req.body.body === 'string') {
            const body = req.body.body.slice(0, 50_000);
            if (!body.trim()) {
                return res.status(400).json({ success: false, message: 'body is required' });
            }
            skill.body = body;
        }
        if (typeof req.body.enabled === 'boolean') {
            skill.enabled = req.body.enabled;
        }
        skill.updatedAtUtc = new Date();
        await skill.save();

        return res.status(200).json({ success: true, skill: serializeSkill(skill) });
    } catch (error) {
        console.error('agent-skills update error:', error);
        return res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : 'Server error',
        });
    }
});

router.post('/:id/toggle', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid id' });
        }

        const skill = await ModelAgentSkill.findById(req.params.id);
        if (!skill) {
            return res.status(404).json({ success: false, message: 'Skill not found' });
        }

        // Toggling a builtin: create/update user override that disables or enables by copy
        if (skill.isBuiltin && !skill.userId) {
            let userCopy = await ModelAgentSkill.findOne({ userId, name: skill.name });
            if (!userCopy) {
                userCopy = await ModelAgentSkill.create({
                    userId,
                    name: skill.name,
                    description: skill.description,
                    body: skill.body,
                    enabled: false,
                    isBuiltin: false,
                    createdAtUtc: new Date(),
                    updatedAtUtc: new Date(),
                });
            } else {
                userCopy.enabled = !userCopy.enabled;
                userCopy.updatedAtUtc = new Date();
                await userCopy.save();
            }
            return res.status(200).json({ success: true, skill: serializeSkill(userCopy) });
        }

        if (!skill.userId || String(skill.userId) !== String(userId)) {
            return res.status(404).json({ success: false, message: 'Skill not found' });
        }

        skill.enabled = !skill.enabled;
        skill.updatedAtUtc = new Date();
        await skill.save();
        return res.status(200).json({ success: true, skill: serializeSkill(skill) });
    } catch (error) {
        console.error('agent-skills toggle error:', error);
        return res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : 'Server error',
        });
    }
});

router.delete('/:id', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid id' });
        }

        const skill = await ModelAgentSkill.findById(req.params.id);
        if (!skill) {
            return res.status(404).json({ success: false, message: 'Skill not found' });
        }

        if (skill.isBuiltin && !skill.userId) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete builtin skills. Disable via toggle or duplicate and edit.',
            });
        }

        if (!skill.userId || String(skill.userId) !== String(userId)) {
            return res.status(404).json({ success: false, message: 'Skill not found' });
        }

        await ModelAgentSkill.deleteOne({ _id: skill._id });
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('agent-skills delete error:', error);
        return res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : 'Server error',
        });
    }
});

/** Duplicate builtin (or any visible skill) into a user-owned skill */
router.post('/:id/duplicate', middlewareUserAuth, async (req: Request, res: Response) => {
    try {
        const userId = res.locals.auth_userId;
        await ensureBuiltinAgentSkills();

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid id' });
        }

        const skill = await ModelAgentSkill.findById(req.params.id).lean();
        if (!skill) {
            return res.status(404).json({ success: false, message: 'Skill not found' });
        }

        const isOwner = skill.userId && String(skill.userId) === String(userId);
        const isBuiltin = skill.isBuiltin && !skill.userId;
        if (!isOwner && !isBuiltin) {
            return res.status(404).json({ success: false, message: 'Skill not found' });
        }

        let baseName = normalizeSkillName(
            typeof req.body.name === 'string' ? req.body.name : `${skill.name}-copy`
        );
        if (!baseName) baseName = `${skill.name}-copy`.slice(0, 64);

        let name = baseName;
        let n = 2;
        while (await ModelAgentSkill.findOne({ userId, name }).select('_id')) {
            name = `${baseName}-${n}`.slice(0, 64);
            n += 1;
            if (n > 50) {
                return res.status(409).json({ success: false, message: 'Could not allocate unique name' });
            }
        }

        const created = await ModelAgentSkill.create({
            userId,
            name,
            description: skill.description,
            body: skill.body,
            enabled: true,
            isBuiltin: false,
            createdAtUtc: new Date(),
            updatedAtUtc: new Date(),
        });

        return res.status(201).json({ success: true, skill: serializeSkill(created) });
    } catch (error) {
        console.error('agent-skills duplicate error:', error);
        return res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : 'Server error',
        });
    }
});

export default router;
