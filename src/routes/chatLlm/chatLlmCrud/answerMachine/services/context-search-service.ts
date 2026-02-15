import mongoose from "mongoose";
import { ModelGlobalSearch } from "../../../../../schema/schemaGlobalSearch/SchemaGlobalSearch.schema";
import { SearchResultItem, ScoredSearchResult } from "../types/answer-machine.types";

/**
 * Service for searching and scoring relevant context
 */
export class ContextSearchService {

    /**
     * Search for relevant context IDs based on keywords
     */
    static async searchContextIds(
        keywords: string[],
        username: string
    ): Promise<mongoose.Types.ObjectId[]> {
        try {
            if (keywords.length === 0) {
                return [];
            }

            console.log(`[Context Search] Searching for keywords: ${keywords.join(', ')}`);

            // Search global search index - simplified search
            const searchQuery: any = { username };
            const keywordRegex = keywords.join('|');
            if (keywordRegex) {
                searchQuery.$or = [
                    { title: { $regex: keywordRegex, $options: 'i' } },
                    { content: { $regex: keywordRegex, $options: 'i' } },
                ];
            }

            const searchResults = await ModelGlobalSearch.find(searchQuery).limit(50) as SearchResultItem[];

            if (searchResults.length === 0) {
                console.log(`[Context Search] No search results found`);
                return [];
            }

            // Score and rank results
            const scoredResults = await this.scoreContextReferences(searchResults, keywords);

            // Sort by relevance score and take top 10
            const topResults = scoredResults
                .sort((a, b) => b.relevanceScore - a.relevanceScore)
                .slice(0, 10);

            const contextIds = topResults.map(result => result.entityId);

            console.log(`[Context Search] Found ${contextIds.length} relevant context items`);
            return contextIds;

        } catch (error) {
            console.error('[Context Search] Error searching context:', error);
            return [];
        }
    }

    /**
     * Score context references based on relevance to keywords
     */
    private static async scoreContextReferences(
        searchResults: SearchResultItem[],
        keywords: string[]
    ): Promise<ScoredSearchResult[]> {
        const scoredResults: Array<{
            entityId: mongoose.Types.ObjectId;
            relevanceScore: number;
            relevanceReason: string;
        }> = [];

        const keywordSet = new Set(keywords.map(k => k.toLowerCase()));

        for (const result of searchResults) {
            let score = 0;
            const reasons: string[] = [];

            // Score based on keyword matches in title (higher weight)
            if (result.title) {
                const titleLower = result.title.toLowerCase();
                const titleMatches = keywords.filter(keyword =>
                    titleLower.includes(keyword.toLowerCase())
                );

                if (titleMatches.length > 0) {
                    score += titleMatches.length * 3; // 3 points per keyword in title
                    reasons.push(`Title matches: ${titleMatches.join(', ')}`);
                }
            }

            // Score based on keyword matches in content
            if (result.content) {
                const contentLower = result.content.toLowerCase();
                const contentMatches = keywords.filter(keyword =>
                    contentLower.includes(keyword.toLowerCase())
                );

                if (contentMatches.length > 0) {
                    score += contentMatches.length * 1; // 1 point per keyword in content
                    if (reasons.length === 0) { // Only add if not already added from title
                        reasons.push(`Content matches: ${contentMatches.slice(0, 3).join(', ')}`);
                    }
                }
            }

            // Score based on tag matches (highest weight)
            if (result.tags && Array.isArray(result.tags)) {
                const tagMatches = result.tags.filter((tag: string) =>
                    keywordSet.has(tag.toLowerCase())
                );

                if (tagMatches.length > 0) {
                    score += tagMatches.length * 5; // 5 points per matching tag
                    reasons.push(`Tag matches: ${tagMatches.join(', ')}`);
                }
            }

            // Boost score for recent items
            if (result.updatedAtUtc) {
                const daysSinceUpdate = (Date.now() - result.updatedAtUtc.getTime()) / (1000 * 60 * 60 * 24);
                if (daysSinceUpdate < 7) {
                    score += 2; // Recent items get bonus
                    reasons.push('Recently updated');
                } else if (daysSinceUpdate < 30) {
                    score += 1; // Somewhat recent
                }
            }

            // Only include results with minimum score
            if (score >= 1) {
                scoredResults.push({
                    entityId: result.entityId,
                    relevanceScore: score,
                    relevanceReason: reasons.join('; ') || 'General relevance',
                });
            }
        }

        return scoredResults;
    }
}