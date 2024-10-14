# vespera-sync-js

## How to install ready-to-use binaries

```bash
wget https://github.com/jujax/vespera-sync-js/releases/latest/download/vespera-sync-linux-arm64.zip -O ./vespera-sync-js.zip
unzip ./vespera-sync-js.zip
chmod +x vespera-sync-js
sudo mv vespera-sync-js /usr/local/bin/vespera-sync
```

## How to build binaries
Binaries are built with macos image on github actions, because it's the only one that supports arm64 builds at this time.
If you faced any issues with the x64 binary, you can build them locally:

```bash
git clone https://github.com/jujax/vespera-sync-js.git
cd vespera-sync-js
npm install
npm i -g pkg
pkg . --targets node18-linux-x64,node18-linux-arm64,node18-macos-arm64

```
