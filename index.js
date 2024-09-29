const ftp = require("basic-ftp");
const fs = require("fs");
const path = require("path");
const { Command } = require("commander");
const version = require("./package.json").version;

const ftpHost = "10.0.0.1"; // Remplacez par votre hôte FTP
const ftpUser = "anonymous"; // Remplacez par votre utilisateur FTP
const ftpPassword = "anonymous"; // Remplacez par votre mot de passe FTP
const remoteDir = "/system"; // Dossier distant à scanner
const localDir = "./ftp"; // Dossier local à comparer
const clients = [];
const client = new ftp.Client();

const program = new Command();

program
  .version(version)
  .description(
    `Vespera-ftp-sync v${version} - Synchronize your Vespera FTP server with a local directory`
  )
  .option("-h, --host <host>", "FTP server address", "10.0.0.1") // Default: 10.0.0.1
  .option("-u, --user <username>", "FTP username", "anonymous") // Default: anonymous user
  .option("-p, --password <password>", "FTP password", "anonymous@") // Default: anonymous password
  .option(
    "-r, --remote-dir <remoteDir>",
    "Remote directory path on the FTP server",
    "/user"
  ) // Default: root directory
  .requiredOption('-l, --local-dir <localDir>", "Local directory path') // Local directory is required
  .option("-s, --secure", "Use secure FTP connection", false) // Default: unsecured FTP
  .option("-d, --daemon", "Run in daemon mode (run in the background)", false) // Option for daemon mode
  .option("-i, --interval <seconds>", "Synchronization interval (seconds)", 10) // Interval in seconds
  // .option(
  //     "-f, --file-types <types>",
  //     "File extensions to download (e.g., tif,jpg)",
  //     "tif,tiff,jpg,jpeg,png"
  // ) // Default file extensions: tiff, jpeg, png
  .option(
    "-c, --concurrency <concurrencyNumber>",
    "Max concurrent downloads",
    9
  ); // Limit the number of concurrent downloads (default: 5)

program.parse(process.argv);

// Get CLI options
const options = program.opts();

async function main(options) {
  try {
    await connectToFtp(
      client,
      options.host,
      options.usernmae,
      options.password
    );
    const remoteFiles = await scanRemoteDirectory(client, options.remoteDir);
    const localFiles = scanLocalDirectory(options.localDir);
    const filesToDownload = compareDirectories(
      remoteFiles,
      localFiles,
      options.remoteDir,
      options.localDir
    );
    await downloadFilesWithLimit(
      client,
      filesToDownload,
      options.localDir,
      options.remoteDir,
      options.concurrencyNumber
    );
  } catch (err) {
    console.error("Erreur :", err);
  } finally {
    client.close();
    console.log("Synchro terminée");
    if (options.daemon) {
      console.log(`Retry in ${options.interval} seconds`);
      setTimeout(() => main(options), options.interval * 1000);
    } else {
      console.log("Good bye !");
      process.exit(0);
    }
  }
}

async function connectToFtp(client, ftpHost, ftpUser, ftpPassword) {
  try {
    await client.access({
      host: ftpHost,
      user: ftpUser,
      password: ftpPassword,
      secure: false, // Si votre serveur FTP supporte TLS, mettez true
    });
    console.log("Connexion FTP réussie");
  } catch (err) {
    console.error("Erreur de connexion au serveur FTP :", err);
  }
}

async function scanRemoteDirectory(client, remoteDir) {
  const fileList = [];
  async function recurseDirectory(currentDir) {
    const files = await client.list(currentDir);
    for (const file of files) {
      const fullPath = path.join(currentDir, file.name);
      if (file.isDirectory) {
        await recurseDirectory(fullPath);
      } else {
        fileList.push({
          name: fullPath,
          size: file.size,
          date: file.modifiedAt,
        });
      }
    }
  }

  await recurseDirectory(remoteDir);
  return fileList;
}

function scanLocalDirectory(localDir) {
  const fileList = [];
  fs.mkdirSync(localDir, { recursive: true });
  function recurseDirectory(currentDir) {
    const files = fs.readdirSync(currentDir);
    for (const file of files) {
      const fullPath = path.join(currentDir, file);
      const stats = fs.statSync(fullPath);
      if (stats.isDirectory()) {
        recurseDirectory(fullPath);
      } else {
        fileList.push({ name: fullPath, size: stats.size, date: stats.mtime });
      }
    }
  }

  recurseDirectory(localDir);
  return fileList;
}

function compareDirectories(remoteFiles, localFiles, remoteBase, localBase) {
  const toDownload = [];

  for (const remoteFile of remoteFiles) {
    const localFilePath = path.join(
      localBase,
      path.relative(remoteBase, remoteFile.name)
    );
    const localFile = localFiles.find((f) => f.name === localFilePath);

    if (
      !localFile ||
      localFile.size !== remoteFile.size ||
      localFile.date < remoteFile.date
    ) {
      toDownload.push(remoteFile);
    }
  }

  return toDownload;
}

async function downloadFilesWithLimit(
  client,
  filesToDownload,
  localBase,
  remoteBase,
  parallelLimit = 9
) {
  let activePromises = [];
  let completedDownloads = 0; // Nombre de téléchargements terminés
  async function downloadFile(file) {
    const downloadClient = new ftp.Client();
    clients.push(downloadClient);
    try {
      await downloadClient.access({
        host: ftpHost,
        user: ftpUser,
        password: ftpPassword,
        secure: false, // Si votre serveur FTP supporte TLS, mettez true
      });
      const localFilePath = path.join(
        localBase,
        path.relative(remoteBase, file.name)
      );
      const localDir = path.dirname(localFilePath);
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }
      console.log(`Téléchargement de ${file.name} vers ${localFilePath}`);
      await downloadClient.downloadTo(localFilePath, file.name);
      await downloadClient.close();
    } catch (e) {
      console.error(e);
      if (e.code === 421) {
        clients.map((client) => {
          client.close();
        });
        client.close();
        console.error("All sockets closed, relaunch program");
        process.exit(1);
      }
    }
  }

  // Fonction pour gérer le pool de promesses
  async function enqueueFile(file) {
    const downloadPromise = downloadFile(file).then(() => {
      // Une fois le téléchargement terminé, on retire cette promesse active
      activePromises = activePromises.filter((p) => p !== downloadPromise);
    });
    activePromises.push(downloadPromise);

    // Si on atteint la limite, attendre qu'une des promesses soit résolue
    if (activePromises.length >= parallelLimit) {
      await Promise.race(activePromises);
    }
  }

  // Enquêter chaque fichier à télécharger
  for (const file of filesToDownload) {
    await enqueueFile(file);
  }

  // Attendre que tous les téléchargements soient terminés
  await Promise.all(activePromises);
}

main(options);
