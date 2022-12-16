module.exports = function runMigration(migration) {
    const test = migration.editContentType('Test');
    test.createField('body').name('body').type('Symbol').required(false);
  };