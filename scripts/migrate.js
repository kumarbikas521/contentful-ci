const { promisify } = require("util");
const { readdir } = require("fs");
const readdirAsync = promisify(readdir);
const path = require("path");
const { createClient } = require("contentful-management");
const { default: runMigration } = require("contentful-migration/built/bin/cli");

async function pocess(){
  return new Promise(async(resolve, reject)=>{
    
  try {
    // utility fns
    const getVersionOfFile = (file) => file.replace(".js", "").replace(/_/g, ".");
    const getFileOfVersion = (version) => version.replace(/\./g, "_") + ".js";

    //
    // Configuration variables
    //
    const [, , SPACE_ID, ENVIRONMENT_INPUT, CMA_ACCESS_TOKEN, DELETED_BRANCH] = process.argv;
    const MIGRATIONS_DIR = path.join(".", "migrations");

    const client = createClient({
      accessToken: CMA_ACCESS_TOKEN,
    });
    const space = await client.getSpace(SPACE_ID);
       // Delete environment from contentful
        if (DELETED_BRANCH != undefined) {
          console.log(`Deleting - ${DELETED_BRANCH} from contentful`)
         try {
          await space.getEnvironment(DELETED_BRANCH).then(async(environment)=>{
            await environment.delete().then(()=>{
              console.log(`Deleted - ${DELETED_BRANCH} from contentful`)
            })            
          })
         } catch (error) {
          console.error("error while deleting environment..")
          console.error(error)
          reject(error)
         }
         return resolve("")        
        }

    var ENVIRONMENT_ID = "";

    let environment;
    console.log("Running with the following configuration");
    console.log(`SPACE_ID: ${SPACE_ID}`);

    if ( ENVIRONMENT_INPUT == 'master' || ENVIRONMENT_INPUT == 'staging' || ENVIRONMENT_INPUT == 'qa') {
      console.log(`Running on ${ENVIRONMENT_INPUT}.`);
      console.log(`Updating ${ENVIRONMENT_INPUT} alias.`);
      ENVIRONMENT_ID = `${ENVIRONMENT_INPUT}-`.concat(getStringDate());
    } else {
      console.log('Running on feature branch');
      ENVIRONMENT_ID = ENVIRONMENT_INPUT;
    }
    console.log(`ENVIRONMENT_ID: ${ENVIRONMENT_ID}`);
    // ---------------------------------------------------------------------------
    console.log(`Checking for existing versions of environment: ${ENVIRONMENT_ID}`);

    try {
      environment = await space.getEnvironment(ENVIRONMENT_ID);
      if ( ENVIRONMENT_ID != 'master' || ENVIRONMENT_ID != 'staging' || ENVIRONMENT_ID != 'qa') {
        await environment.delete();
        console.log('Environment deleted');
      }
    } catch (e) {
      console.log('Environment not found');
    }

    // ---------------------------------------------------------------------------
    if (ENVIRONMENT_ID != 'master' || ENVIRONMENT_ID != 'staging' || ENVIRONMENT_ID != 'qa') {
      console.log(`Creating environment ${ENVIRONMENT_ID}`);
      environment = await space.createEnvironmentWithId(ENVIRONMENT_ID, {
        name: ENVIRONMENT_ID,
      });
    }
    // ---------------------------------------------------------------------------
    const DELAY = 3000;
    const MAX_NUMBER_OF_TRIES = 10;
    let count = 0;

    console.log('Waiting for environment processing...');

    while (count < MAX_NUMBER_OF_TRIES) {
      const status = (await space.getEnvironment(environment.sys.id)).sys.status.sys
        .id;

      if (status === 'ready' || status === 'failed') {
        if (status === 'ready') {
          console.log(`Successfully processed new environment (${ENVIRONMENT_ID})`);
        } else {
          console.log('Environment creation failed');
        }
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, DELAY));
      count++;
    }

    // ---------------------------------------------------------------------------
    console.log('Update API keys to allow access to new environment');
    const newEnv = {
      sys: {
        type: 'Link',
        linkType: 'Environment',
        id: ENVIRONMENT_ID,
      },
    };

    const { items: keys } = await space.getApiKeys();
    await Promise.all(
      keys.map((key) => {
        console.log(`Updating - ${key.sys.id}`);
        key.environments.push(newEnv);
        return key.update();
      })
    );

    // ---------------------------------------------------------------------------
    console.log('Set default locale to new environment');
    const defaultLocale = (await environment.getLocales()).items.find(
      (locale) => locale.default
    ).code;

    // ---------------------------------------------------------------------------
    console.log('Read all the available migrations from the file system');
    console.log(`Directoy -  ${MIGRATIONS_DIR}`)
    const files = await readdirAsync(MIGRATIONS_DIR)
    console.log(`list of files ${files}`);
     const availableMigrations = files.filter((file) => /^\d+?\.js$/.test(file))
      .map((file) => getVersionOfFile(file));
      console.log(`availableMigrations - ${availableMigrations}`)
    // ---------------------------------------------------------------------------
    console.log('Figure out latest ran migration of the contentful space');
    const { items: versions } = await environment.getEntries({
      content_type: 'versionTracking'
    });

    if (!versions.length || versions.length > 1) {
      throw new Error("There should only be one entry of type 'versionTracking'");
    }

    let storedVersionEntry = versions[0];
    const currentVersionString = storedVersionEntry.fields.version[defaultLocale];
    console.log(`curent vesion - ${currentVersionString}`)
    // ---------------------------------------------------------------------------
    console.log('Evaluate which migrations to run');
    const currentMigrationIndex = availableMigrations.indexOf(currentVersionString);

    if (currentMigrationIndex === -1) {
      throw new Error(
        `Version ${currentVersionString} is not matching with any known migration`
      );
    }
    const migrationsToRun = availableMigrations.slice(currentMigrationIndex + 1);
    console.log(`migrationsToRun - ${migrationsToRun}`)
    const migrationOptions = {
      spaceId: SPACE_ID,
      environmentId: ENVIRONMENT_ID,
      accessToken: CMA_ACCESS_TOKEN,
      yes: true,
    };

    // ---------------------------------------------------------------------------
    console.log('Run migrations and update version entry');
    while ((migrationToRun = migrationsToRun.shift())) {
      const filePath = path.join(
        __dirname,
        '..',
        'migrations',
        getFileOfVersion(migrationToRun)
      );
      console.log(`Running ${filePath}`);
      await runMigration(
        Object.assign(migrationOptions, {
          filePath,
        })
      );
      console.log(`${migrationToRun} succeeded`);

      storedVersionEntry.fields.version[defaultLocale] = migrationToRun;
      storedVersionEntry = await storedVersionEntry.update();
      storedVersionEntry = await storedVersionEntry.publish();

      console.log(`Updated version entry to ${migrationToRun}`);
    }

    // ---------------------------------------------------------------------------
    console.log('Checking if we need to update an alias');
    if ( ENVIRONMENT_INPUT == 'master' || ENVIRONMENT_INPUT == 'staging' || ENVIRONMENT_INPUT == 'qa') {
      console.log(`Running on ${ENVIRONMENT_INPUT}.`);
      console.log(`Updating ${ENVIRONMENT_INPUT} alias.`);
      await updateAlias(client, SPACE_ID, ENVIRONMENT_INPUT, ENVIRONMENT_ID)
      .then((alias)=>{
        console.log(`${ENVIRONMENT_INPUT} alias updated.`);
      })
      .catch((err)=>{
        console.error(err)
      })
      
    } else {
      console.log('Running on feature branch');
      console.log('No alias changes required');
    }
    console.log('All done!');
  } catch (e) {

  }

  })
}

async function updateAlias(client, spaceId, ENVIRONMENT_INPUT, ENVIRONMENT_ID){
  return new Promise(async(resolve, reject)=>{
   try {
    await client.getSpace(spaceId).then((space)=>{
			space.getEnvironmentAlias(ENVIRONMENT_INPUT)
		.then((alias) => {
         alias.environment.sys.id = ENVIRONMENT_ID;
         resolve(alias.update())
      })
      .catch(console.error);
		})
   } catch (error) {
    console.log(error)
   }
  })
}

function getStringDate() {
  var d = new Date();

  function pad(n) {
    return n < 10 ? '0' + n : n;
  }
  return (
    d.toISOString().substring(0, 10) +
    '-' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes())
  );
}

pocess()