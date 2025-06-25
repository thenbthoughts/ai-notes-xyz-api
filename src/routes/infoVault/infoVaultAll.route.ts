import { Router } from 'express';

import infoVaultCrud from './infoVaultCrud.route';
import infoVaultAddressCrud from './infoVaultAddressCrud.route';
import infoVaultEmailCrud from './infoVaultEmailCrud.route';
import infoVaultPhoneCrud from './infoVaultPhoneCrud.route';
import infoVaultWebsiteCrud from './infoVaultWebsiteCrud.route';
import infoVaultCustomFieldCrud from './infoVaultCustomFieldCrud.route';
import infoVaultRelatedPersonCrud from './infoVaultRelatedPersonCrud.route';
import infoVaultSignificantDateCrud from './infoVaultSignificantDateCrud.route';
import infoVaultFileUploadCrud from './infoVaultFileUploadCrud.route';

const router = Router();

// InfoVault main CRUD routes
router.use('/crud', infoVaultCrud);

// InfoVault related entity CRUD routes
router.use('/address', infoVaultAddressCrud);
router.use('/email', infoVaultEmailCrud);
router.use('/phone', infoVaultPhoneCrud);
router.use('/website', infoVaultWebsiteCrud);
router.use('/customField', infoVaultCustomFieldCrud);
router.use('/relatedPerson', infoVaultRelatedPersonCrud);
router.use('/significantDate', infoVaultSignificantDateCrud);
router.use('/fileUpload', infoVaultFileUploadCrud);

export default router; 