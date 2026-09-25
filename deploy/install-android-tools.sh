#!/bin/sh
# Installs a private JDK and Android SDK without sudo. Requires Node 24, curl, tar, unzip.
set -eu
ROOT="${ANDROID_TOOLS_DIR:-$HOME/.local/share/publishing-android}"
case "$(uname -sm)" in
  'Linux x86_64') OS=linux; TOOLS_SHA1=5fdcc763663eefb86a5b8879697aa6088b041e70 ;;
  'Darwin x86_64') OS=mac; TOOLS_SHA1=c3e06a1959762e89167d1cbaa988605f6f7c1d24 ;;
  *) echo 'This installer supports Linux x64 and macOS Intel.' >&2; exit 1 ;;
esac
mkdir -p "$ROOT/downloads"
if [ ! -f "$ROOT/java-home" ]; then
  curl -fsSL --retry 3 "https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=$OS&vendor=eclipse" -o "$ROOT/downloads/jdk.json"
  node --input-type=module - "$ROOT" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = process.argv[2], info = JSON.parse(fs.readFileSync(path.join(root,'downloads/jdk.json')))[0].binary.package;
const archive = path.join(root,'downloads/jdk.tar.gz');
execFileSync('curl',['-fL','--retry','3',info.link,'-o',archive],{stdio:'inherit'});
if (createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== info.checksum) throw new Error('JDK checksum mismatch');
fs.mkdirSync(path.join(root,'jdk'),{recursive:true});
execFileSync('tar',['-xzf',archive,'-C',path.join(root,'jdk')]);
const directory = fs.readdirSync(path.join(root,'jdk')).find(p=>fs.statSync(path.join(root,'jdk',p)).isDirectory());
fs.writeFileSync(path.join(root,'java-home'),path.join(root,'jdk',directory,process.platform==='darwin'?'Contents/Home':''));
JS
fi
JAVA_HOME=$(cat "$ROOT/java-home")
ANDROID_HOME="$ROOT/sdk"
export JAVA_HOME ANDROID_HOME
PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
export PATH
if [ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
  curl -fL --retry 3 "https://dl.google.com/android/repository/commandlinetools-${OS}-13114758_latest.zip" -o "$ROOT/downloads/tools.zip"
  node --input-type=module - "$ROOT/downloads/tools.zip" "$TOOLS_SHA1" <<'JS'
import fs from 'node:fs'; import {createHash} from 'node:crypto';
if(createHash('sha1').update(fs.readFileSync(process.argv[2])).digest('hex')!==process.argv[3])throw new Error('SDK checksum mismatch');
JS
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  unzip -q -o "$ROOT/downloads/tools.zip" -d "$ANDROID_HOME/cmdline-tools"
  mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" --licenses >/dev/null
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" 'platform-tools' 'platforms;android-36' 'build-tools;35.0.0'
printf '\nAdd these absolute paths to the platform .env, then restart:\nJAVA_HOME=%s\nANDROID_HOME=%s\n' "$JAVA_HOME" "$ANDROID_HOME"
printf 'Keep ~/.android/debug.keystore across upgrades so test APKs remain upgradeable.\n'
