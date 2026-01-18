import mongoose from 'mongoose';
import { PipelineStage } from 'mongoose';

import { getMongodbObjectOrNull } from '../common/getMongodbObjectOrNull';

import { IGlobalSearch } from '../../types/typesSchema/typesGlobalSearch/SchemaGlobalSearch.types';
import { ModelGlobalSearch } from '../../schema/schemaGlobalSearch/SchemaGlobalSearch.schema';

import { ModelInfoVault } from '../../schema/schemaInfoVault/SchemaInfoVault.schema';
import { IInfoVaultContact } from '../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVault.types';
import { IInfoVaultAddress } from '../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVaultAddress.types';
import { IInfoVaultEmail } from '../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVaultEmail.types';
import { IInfoVaultPhone } from '../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVaultPhone.types';
import { IInfoVaultWebsite } from '../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVaultWebsite.types';
import { IInfoVaultRelatedPerson } from '../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVaultRelatedPerson.types';
import { IInfoVaultSignificantDate } from '../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVaultSignificantDate.types';
import { IInfoVaultCustomField } from '../../types/typesSchema/typesSchemaInfoVault/SchemaInfoVaultCustomField.types';
import { ISchemaCommentCommon } from '../../types/typesSchema/typesSchemaCommentCommon/schemaCommentCommonList.types';
import { IFaq } from '../../types/typesSchema/typesFaq/SchemaFaq.types';
import { ILlmContextKeyword } from '../../types/typesSchema/typesLlmContext/SchemaLlmContextKeyword.types';

export const funcSearchReindexInfoVaultById = async ({
    recordId,
}: {
    recordId: string;
}): Promise<IGlobalSearch | null> => {
    interface IInfoVaultAggregate extends IInfoVaultContact {
        _id: mongoose.Types.ObjectId;
        username: string;
        addresses: IInfoVaultAddress[];
        emails: IInfoVaultEmail[];
        phones: IInfoVaultPhone[];
        websites: IInfoVaultWebsite[];
        relatedPersons: IInfoVaultRelatedPerson[];
        significantDates: IInfoVaultSignificantDate[];
        customFields: IInfoVaultCustomField[];
        comments: ISchemaCommentCommon[];
        aiContextFaq: IFaq[];
        aiContextKeywords: ILlmContextKeyword[];
    }

    try {
        const pipelineDocument = [
            { $match: { _id: getMongodbObjectOrNull(recordId) } },
            {
                $lookup: {
                    from: 'infoVaultAddress',
                    localField: '_id',
                    foreignField: 'infoVaultId',
                    as: 'addresses',
                }
            },
            {
                $lookup: {
                    from: 'infoVaultEmail',
                    localField: '_id',
                    foreignField: 'infoVaultId',
                    as: 'emails',
                }
            },
            {
                $lookup: {
                    from: 'infoVaultPhone',
                    localField: '_id',
                    foreignField: 'infoVaultId',
                    as: 'phones',
                }
            },
            {
                $lookup: {
                    from: 'infoVaultWebsite',
                    localField: '_id',
                    foreignField: 'infoVaultId',
                    as: 'websites',
                }
            },
            {
                $lookup: {
                    from: 'infoVaultRelatedPerson',
                    localField: '_id',
                    foreignField: 'infoVaultId',
                    as: 'relatedPersons',
                }
            },
            {
                $lookup: {
                    from: 'infoVaultSignificantDate',
                    localField: '_id',
                    foreignField: 'infoVaultId',
                    as: 'significantDates',
                }
            },
            {
                $lookup: {
                    from: 'infoVaultCustomField',
                    localField: '_id',
                    foreignField: 'infoVaultId',
                    as: 'customFields',
                }
            },
            {
                $lookup: {
                    from: 'commentsCommon',
                    localField: '_id',
                    foreignField: 'entityId',
                    as: 'comments',
                }
            },
            {
                $lookup: {
                    from: 'aiFaq',
                    localField: '_id',
                    foreignField: 'metadataSourceId',
                    as: 'aiContextFaq',
                }
            },
            {
                $lookup: {
                    from: 'llmContextKeyword',
                    localField: '_id',
                    foreignField: 'metadataSourceId',
                    as: 'aiContextKeywords',
                }
            },
            { $limit: 1 }
        ] as PipelineStage[];

        const infoVaultAggArr = await ModelInfoVault.aggregate(pipelineDocument) as IInfoVaultAggregate[];
        const infoVault = infoVaultAggArr[0];

        if (!infoVault) {
            return null;
        }

        const textParts: string[] = [];
        // Basic information
        if (infoVault.name) textParts.push(infoVault.name.toLowerCase());
        if (infoVault.nickname) textParts.push(infoVault.nickname.toLowerCase());
        if (infoVault.infoVaultType) textParts.push(infoVault.infoVaultType.toLowerCase());
        if (infoVault.infoVaultSubType) textParts.push(infoVault.infoVaultSubType.toLowerCase());

        // Professional information
        if (infoVault.company) textParts.push(infoVault.company.toLowerCase());
        if (infoVault.jobTitle) textParts.push(infoVault.jobTitle.toLowerCase());
        if (infoVault.department) textParts.push(infoVault.department.toLowerCase());

        // Additional information
        if (infoVault.notes) textParts.push(infoVault.notes.toLowerCase());

        // Organization & categorization
        if (Array.isArray(infoVault.tags)) {
            textParts.push(...infoVault.tags.map((tag: string) => tag.toLowerCase()));
        }
        if (infoVault.isFavorite) {
            textParts.push('favorite');
            textParts.push('starred');
            textParts.push('important');
        }

        // Relationship context
        if (infoVault.relationshipType) textParts.push(infoVault.relationshipType.toLowerCase());
        if (infoVault.contactFrequency) textParts.push(infoVault.contactFrequency.toLowerCase());

        // AI enhancement
        if (infoVault.aiSummary) textParts.push(infoVault.aiSummary.toLowerCase());
        if (Array.isArray(infoVault.aiTags)) {
            textParts.push(...infoVault.aiTags.map((tag: string) => tag.toLowerCase()));
        }
        if (infoVault.aiSuggestions) textParts.push(infoVault.aiSuggestions.toLowerCase());

        // Related entities
        // addresses
        if (Array.isArray(infoVault.addresses) && infoVault.addresses.length > 0) {
            for (const address of infoVault.addresses) {
                if (address.address) textParts.push(address.address.toLowerCase());
                if (address.city) textParts.push(address.city.toLowerCase());
                if (address.state) textParts.push(address.state.toLowerCase());
                if (address.countryRegion) textParts.push(address.countryRegion.toLowerCase());
                if (address.pincode) textParts.push(address.pincode.toLowerCase());
                if (address.label) textParts.push(address.label.toLowerCase());
            }
        }

        // emails
        if (Array.isArray(infoVault.emails) && infoVault.emails.length > 0) {
            for (const email of infoVault.emails) {
                if (email.email) textParts.push(email.email.toLowerCase());
                if (email.label) textParts.push(email.label.toLowerCase());
            }
        }

        // phones
        if (Array.isArray(infoVault.phones) && infoVault.phones.length > 0) {
            for (const phone of infoVault.phones) {
                if (phone.phoneNumber) textParts.push(phone.phoneNumber.toLowerCase());
                if (phone.countryCode) textParts.push(phone.countryCode.toLowerCase());
                if (phone.label) textParts.push(phone.label.toLowerCase());
            }
        }

        // websites
        if (Array.isArray(infoVault.websites) && infoVault.websites.length > 0) {
            for (const website of infoVault.websites) {
                if (website.url) textParts.push(website.url.toLowerCase());
                if (website.label) textParts.push(website.label.toLowerCase());
            }
        }

        // related persons
        if (Array.isArray(infoVault.relatedPersons) && infoVault.relatedPersons.length > 0) {
            for (const person of infoVault.relatedPersons) {
                if (person.relatedPersonName) textParts.push(person.relatedPersonName.toLowerCase());
                if (person.label) textParts.push(person.label.toLowerCase());
            }
        }

        // significant dates
        if (Array.isArray(infoVault.significantDates) && infoVault.significantDates.length > 0) {
            for (const date of infoVault.significantDates) {
                if (date.label) textParts.push(date.label.toLowerCase());
            }
        }

        // custom fields
        if (Array.isArray(infoVault.customFields) && infoVault.customFields.length > 0) {
            for (const field of infoVault.customFields) {
                if (field.key) textParts.push(field.key.toLowerCase());
                if (field.value) textParts.push(field.value.toLowerCase());
            }
        }

        // comments
        if (Array.isArray(infoVault.comments) && infoVault.comments.length > 0) {
            for (const comment of infoVault.comments) {
                if (typeof comment?.commentText === 'string') {
                    textParts.push(comment?.commentText?.toLowerCase());
                }
            }
        }

        // ai keywords
        if (Array.isArray(infoVault.aiContextKeywords) && infoVault.aiContextKeywords.length > 0) {
            for (const keyword of infoVault.aiContextKeywords) {
                if (typeof keyword?.keyword === 'string' && keyword.keyword) {
                    textParts.push(keyword.keyword.toLowerCase());
                }
                if (typeof keyword?.aiCategory === 'string' && keyword.aiCategory) {
                    textParts.push(keyword.aiCategory.toLowerCase());
                }
                if (typeof keyword?.aiSubCategory === 'string' && keyword.aiSubCategory) {
                    textParts.push(keyword.aiSubCategory.toLowerCase());
                }
                if (typeof keyword?.aiTopic === 'string' && keyword.aiTopic) {
                    textParts.push(keyword.aiTopic.toLowerCase());
                }
                if (typeof keyword?.aiSubTopic === 'string' && keyword.aiSubTopic) {
                    textParts.push(keyword.aiSubTopic.toLowerCase());
                }
            }
        }

        // ai faq
        if (Array.isArray(infoVault.aiContextFaq) && infoVault.aiContextFaq.length > 0) {
            for (const faq of infoVault.aiContextFaq) {
                if (typeof faq?.question === 'string') {
                    textParts.push(faq.question.toLowerCase());
                }
                if (typeof faq?.answer === 'string') {
                    textParts.push(faq.answer.toLowerCase());
                }
                if (typeof faq?.aiCategory === 'string' && faq.aiCategory) {
                    textParts.push(faq.aiCategory.toLowerCase());
                }
                if (typeof faq?.aiSubCategory === 'string' && faq.aiSubCategory) {
                    textParts.push(faq.aiSubCategory.toLowerCase());
                }
                if (Array.isArray(faq?.tags)) {
                    textParts.push(...faq.tags.filter((tag: string) => typeof tag === 'string').map((tag: string) => tag.toLowerCase()));
                }
            }
        }

        const searchableText = textParts
            .map((part: string) => part.trim())
            .filter((part: string) => part.length > 0)
            .map((part: string) => part.toLowerCase().replace(/\s+/g, ' ').replace(/\n/g, ''))
            .join(' ');

        // delete many
        await ModelGlobalSearch.deleteMany({
            entityId: infoVault._id,
        });

        // insert new record
        await ModelGlobalSearch.create({
            entityId: infoVault._id,
            username: infoVault.username,
            text: searchableText,
            collectionName: 'infoVault',
            updatedAtUtc: infoVault.updatedAtUtc || new Date(),

            rawData: {
                infoVault,
            }
        });

        return null;
    } catch (error) {
        console.error('Error getting insert object from info vault:', error);
        return null;
    }
};