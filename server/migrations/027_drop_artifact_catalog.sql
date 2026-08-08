-- Files became a plain folder (pop-agent.spec §14, spec 1.58): the catalog dies.
-- The rows are exported to POP_AGENT_DATA_DIR/files/ by bootstrap BEFORE the
-- migrations run (the export reads these tables from the pre-migration file),
-- so by the time this executes the data already lives on disk under its real
-- names. Versions are not carried over -- overwrite is the feature now.

DROP TABLE IF EXISTS artifact_chunks;
DROP TABLE IF EXISTS artifact_versions;
DROP TABLE IF EXISTS artifacts;
DROP TABLE IF EXISTS folders;
DROP TABLE IF EXISTS path_index;
