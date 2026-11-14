// Retired: the original prototype selected ALL department scenarios and
// altered scenario maxLoad without first verifying approved instructor limits.
// Never run that prototype on operational snapshots.
// Use the audited, explicit three-scenario read-only workflow instead.
console.error('The legacy load24 prototype is retired for safety.');
console.error('Use: node scripts/load24-operational.mjs list --department-id <UUID>');
console.error('See docs/LOAD24_SAFE_HANDOFF.md for prepare and guarded commit steps.');
process.exitCode=1;
