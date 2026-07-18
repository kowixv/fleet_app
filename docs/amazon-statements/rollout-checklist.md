# Amazon Statements Rollout Checklist

1. Capture a database backup and current application deployment metadata.
2. Run `scripts/amazon-statements-preflight.sql` in read-only mode and stop on missing prerequisites.
3. Apply migrations in this order only:
   - `20260716010000`
   - `20260716020000`
   - `20260716030000`
   - `20260716040000`
   - `20260716050000`
   - `20260716060000`
   - `20260716070000`
4. run post-migration verification with `scripts/amazon-statements-post-migration-verify.sql` in read-only mode.
5. Run the live hardening verification script against the target project.
6. Deploy application code only after database verification passes.
7. Create one synthetic/manual Amazon import batch.
8. Verify upload and parser registration without exposing storage paths.
9. Verify projection preview and controlled apply.
10. Verify candidate preview and saved source selections.
11. Verify atomic conversion through `convert_amazon_candidate_atomic`.
12. Verify final statement PDF preview/download.
13. Confirm rollback limitations: converted candidates and settlement link rows are auditable records, not simple reversible UI state.
14. Stop rollout immediately on any migration error, broad RLS policy, missing fixed `search_path`, failed conversion uniqueness check, duplicate active projection, or unexpected direct settlement insert path.

Do not use private sample files in rollout artifacts or logs.
