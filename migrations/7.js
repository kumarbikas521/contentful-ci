module.exports = function runMigration(migration) {
    const test = migration.editContentType('Test');
    test.editField('section').required(false);
  };