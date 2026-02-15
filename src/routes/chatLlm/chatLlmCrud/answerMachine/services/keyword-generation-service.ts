import mongoose from "mongoose";
import fetchLlmUnified, { Message } from "../../../../../utils/llmPendingTask/utils/fetchLlmUnified";
import { LlmConfigService } from "../config/llm-config-service";

/**
 * Service for generating keywords from questions
 */
export class KeywordGenerationService {

    /**
     * Generate keywords from a question for context search
     */
    static async generateKeywords(
        question: string,
        username: string
    ): Promise<string[]> {
        try {
            console.log(`[Keyword Generation] Getting LLM config for user: ${username}`);
            const llmConfig = await LlmConfigService.getLlmConfigForUser(username);
            if (!llmConfig) {
                console.warn('[Keyword Generation] No LLM config available for keyword generation');
                return this.extractBasicKeywords(question);
            }
            console.log(`[Keyword Generation] Using config: ${llmConfig.provider} - ${llmConfig.model}`);

            const systemPrompt = `You are a keyword extraction specialist. Extract the most relevant keywords and key phrases from the given question that would be useful for searching related content in a knowledge base.

Return a comma-separated list of the most important keywords and short phrases (2-4 words max each).

Focus on:
- Important nouns and noun phrases
- Technical terms
- Specific names, dates, or identifiers
- Key concepts

Limit to 5-10 keywords maximum. Return only the keywords separated by commas, no explanation.`;

            const userPrompt = `Question: ${question}`;

            const messages: Message[] = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ];

            const llmResult = await fetchLlmUnified({
                provider: llmConfig.provider,
                apiKey: llmConfig.apiKey,
                apiEndpoint: llmConfig.apiEndpoint,
                model: llmConfig.model,
                messages,
                temperature: 0.3,
                maxTokens: 200,
                headersExtra: llmConfig.customHeaders,
            });

            if (!llmResult.success || !llmResult.content) {
                console.warn(`LLM keyword generation failed (${llmResult.error}), using basic extraction`);
                return this.extractBasicKeywords(question);
            }

            try {
                // Try to parse as JSON first
                const parsed = JSON.parse(llmResult.content.trim());
                if (Array.isArray(parsed)) {
                    return parsed.slice(0, 10); // Limit to 10 keywords
                }

                // Handle case where LLM returns object with keywords array
                if (parsed.keywords && Array.isArray(parsed.keywords)) {
                    return parsed.keywords.slice(0, 10);
                }
            } catch (parseError) {
                // If JSON parsing fails, extract keywords from the text response
                console.log('LLM response not JSON, extracting keywords from text');
            }

            // Extract keywords from text response
            const keywords = llmResult.content
                .split(/[,;\n]/)
                .map(k => k.trim().replace(/^["']|["']$/g, '')) // Remove quotes
                .filter(k => k.length > 0 && k.length <= 50) // Filter out empty or too long
                .slice(0, 10);

            return keywords.length > 0 ? keywords : this.extractBasicKeywords(question);

        } catch (error) {
            console.error('Error in keyword generation:', error);
            return this.extractBasicKeywords(question);
        }
    }

    /**
     * Extract basic keywords using simple text processing
     */
    private static extractBasicKeywords(question: string): string[] {
        // Simple keyword extraction as fallback
        const words = question.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 3)
            .filter(word => !this.isStopWord(word))
            .slice(0, 8); // Take first 8 meaningful words

        return [...new Set(words)]; // Remove duplicates
    }

    /**
     * Check if word is a common stop word
     */
    private static isStopWord(word: string): boolean {
        const stopWords = new Set([
            'what', 'when', 'where', 'which', 'that', 'this', 'with', 'from',
            'have', 'been', 'were', 'does', 'will', 'would', 'could', 'should',
            'about', 'after', 'before', 'their', 'there', 'these', 'those',
            'they', 'them', 'then', 'than', 'such', 'some', 'same', 'said',
            'each', 'every', 'other', 'another', 'between', 'during', 'while'
        ]);

        return stopWords.has(word);
    }
}