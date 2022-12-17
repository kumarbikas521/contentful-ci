module.exports = function runMigration(migration) {
    const test = migration.editContentType('Test');
    test.createField('section').name('section').type('Symbol').required(false);
  };