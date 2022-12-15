module.exports = function runMigration(migration) {
    const test = migration.createContentType('Test');
    test.createField('id').name('id').type('Symbol').required(false);
  };