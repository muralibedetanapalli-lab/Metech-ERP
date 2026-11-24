-- The built-in "Common" cost centre: bills and expenses shared by every project.
-- Project costing adds them to shared costs and splits them across projects by revenue share.
INSERT INTO "CostCentre" ("id", "code", "name", "kind", "description", "active", "createdAt", "syncEnabled")
VALUES ('cc_common', 'COMMON', 'Common (shared)', 'COMMON', 'Costs shared by all projects; split across projects by revenue share in project costing.', true, CURRENT_TIMESTAMP, false)
ON CONFLICT ("code") DO NOTHING;
