import { Router } from 'express';
import { UserRole } from '@careerpilot/shared';
import * as controller from '../../controllers/analytics.controller';
import { authenticate, authorize } from '../../middleware/auth';
import { aiLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { analyticsQuery, researchExportQuery } from '../../validators';

export const analyticsRouter = Router();

// Institutional analytics are staff-only: they aggregate other people's data.
analyticsRouter.use(authenticate, authorize(UserRole.PLACEMENT_OFFICER, UserRole.ADMIN));

analyticsRouter.get('/placement', validate({ query: analyticsQuery }), controller.placementAnalytics);
analyticsRouter.get('/insights', aiLimiter, validate({ query: analyticsQuery }), controller.cohortInsights);
analyticsRouter.get('/filters', controller.filterOptions);

// Research export (§42): pseudonymised, provenance-tagged and audited.
analyticsRouter.get('/research-export', validate({ query: researchExportQuery }), controller.researchExport);
