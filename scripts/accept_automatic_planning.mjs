import fs from 'node:fs';
import {
  calculateAutomaticPlan,
  extractHistoricalCapacities,
  extractHistoricalCourseSettings,
  extractHistoricalLevelCounts,
  importAutomaticCurriculumCsv,
  normalizeCourseCode,
  resolveLevelDemand,
} from '../dist/src/automatic-planning.js';
import {readAutomaticWorkbook} from '../dist/src/automatic-xlsx.js';

const [csvPath, workbookPath] = process.argv.slice(2);
if (!csvPath || !workbookPath) {
  console.error('Usage: node scripts/accept_automatic_planning.mjs <curriculum.csv> <historical.xlsx>');
  process.exitCode = 2;
} else {
  const curriculum = importAutomaticCurriculumCsv(
    fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, ''),
  );
  const sheets = await readAutomaticWorkbook(fs.readFileSync(workbookPath));
  const courseSheet = sheets.find((sheet) => sheet.name === 'المقررات');
  const settingsSheet = sheets.find((sheet) => sheet.name === 'الإعدادات');
  if (!courseSheet || !settingsSheet) throw new Error('Required workbook sheets were not found');

  const historical = extractHistoricalLevelCounts(courseSheet.rows);
  const courseSettings = extractHistoricalCourseSettings(courseSheet.rows);
  const capacities = extractHistoricalCapacities(settingsSheet.rows);
  if (!capacities) throw new Error('Workbook capacity settings were not found');

  const workbookCodes = new Set(courseSettings.settings.map((item) => normalizeCourseCode(item.code)));
  const planCodes = new Set(curriculum.courses.map((course) => course.normalizedCode));
  const alternatives = curriculum.courses.filter((course) => course.alternativeGroup).map((course) => ({
    code: course.code,
    normalizedCode: course.normalizedCode,
    kind: course.specialKind,
    group: course.alternativeGroup,
    presentInWorkbook: workbookCodes.has(course.normalizedCode),
  }));
  const alternativeSelections = {};
  for (const alternative of alternatives) {
    if (alternative.presentInWorkbook) alternativeSelections[alternative.group] = alternative.code;
  }
  const selectedAlternativeCodes = new Set(
    Object.values(alternativeSelections).map((code) => normalizeCourseCode(code)),
  );
  const missingRequired = curriculum.courses
    .filter((course) => !workbookCodes.has(course.normalizedCode))
    .filter((course) => !course.alternativeGroup || selectedAlternativeCodes.has(course.normalizedCode))
    .map((course) => course.normalizedCode);

  const demand = resolveLevelDemand(
    curriculum.levels.map(({level}) => level),
    [{
      kind: 'HISTORICAL_WORKBOOK',
      counts: historical.counts,
      label: 'attached historical scheduling workbook',
      confidence: 'MEDIUM',
    }],
  );
  const calculation = calculateAutomaticPlan(
    curriculum,
    demand.levels,
    capacities,
    courseSettings.settings,
    alternativeSelections,
  );

  const summary = {
    schemaVersion: 'tps.automatic-planning-acceptance.v1',
    workbookSheets: sheets.map((sheet) => sheet.name),
    curriculum: {
      sourceRows: curriculum.sourceRows,
      courseCount: curriculum.courses.length,
      levels: curriculum.levels.map(({level, courses}) => ({level, courseCount: courses.length})),
      credits: [...new Set(curriculum.courses.map((course) => course.credits))]
        .sort((left, right) => (left ?? 0) - (right ?? 0)),
      coursesWithPrerequisites: curriculum.courses.filter((course) => course.prerequisites.length > 0).length,
      coursesWithEquivalents: curriculum.courses.filter((course) => course.equivalents.length > 0).length,
      warnings: curriculum.warnings,
    },
    history: {
      levelCounts: historical.counts,
      countWarnings: historical.warnings,
      courseCount: courseSettings.courseCount,
      courseWarnings: courseSettings.warnings,
      capacities,
    },
    reconciliation: {
      matchedCourseCount: [...planCodes].filter((code) => workbookCodes.has(code)).length,
      missingInWorkbook: [...planCodes].filter((code) => !workbookCodes.has(code)),
      missingRequired,
      extraInWorkbook: [...workbookCodes].filter((code) => !planCodes.has(code)),
      alternatives,
      alternativeSelections,
    },
    demand,
    calculation: {
      totals: calculation.totals,
      calculatedCourseCount: calculation.courses.length,
      completeCourseCount: calculation.courses.filter((course) => course.complete).length,
      incompleteCourseCount: calculation.courses.filter((course) => !course.complete).length,
      missingInputs: calculation.missingInputs,
      discrepancies: calculation.courses.filter((course) => course.discrepancy).map((course) => ({
        code: course.code,
        ...course.discrepancy,
      })),
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  if (demand.missing.length || historical.warnings.length || courseSettings.warnings.length ||
      summary.reconciliation.extraInWorkbook.length || missingRequired.length || calculation.missingInputs.length) {
    process.exitCode = 1;
  }
}
