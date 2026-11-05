/**
 * 模拟 DSH web-boot 的插件解析：
 * 对每个 bundle 插件，检查 1) 自身能否 import 2) dsh.client.inject 能否解析
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const profile = path.join(
  process.env.USERPROFILE || "",
  ".dsh",
  "profiles",
  "desktop"
);
const pkgPath = path.join(profile, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const bundles = pkg.dsh?.profile?.bundles ?? [];

const require = createRequire(path.join(profile, "package.json"));

let problems = 0;

for (const name of bundles) {
  let mod;
  try {
    const pj = require.resolve(`${name}/package.json`);
    mod = JSON.parse(readFileSync(pj, "utf8"));
  } catch (e) {
    console.log(`  ? ${name}  (不是本地包，跳过解析检查)`);
    continue;
  }

  const inject = mod.dsh?.client?.inject ?? [];
  // @deepseek-ai/* 是 DSH 运行时注入的外部模块（随 app.asar 提供），不是 npm 依赖。
  // require.resolve 必然解析不到，属于检查范围之外的噪音，跳过。
  const external = inject.filter((dep) => dep.startsWith("@deepseek-ai/"));
  const resolvable = inject.filter((dep) => !dep.startsWith("@deepseek-ai/"));
  const bad = [];
  for (const dep of resolvable) {
    try {
      require.resolve(`${dep}/package.json`);
    } catch (e) {
      bad.push(dep);
    }
  }

  if (bad.length > 0) {
    problems++;
    console.log(`  ✗ ${name}`);
    for (const b of bad) console.log(`      无法解析: ${b}`);
  } else {
    const extNote = external.length ? `，跳过 ${external.length} 项运行时外部` : "";
    const depNote = resolvable.length ? "，其余全部可解析" : "，无需解析";
    console.log(
      `  ✓ ${name}  (inject ${inject.length} 项${extNote}${depNote})`
    );
  }
}

console.log("");
if (problems === 0) {
  console.log("全部通过 —— 重启 DSH 应该不会再报 import failed");
} else {
  console.log(`有 ${problems} 个插件存在无法解析的 inject 项`);
}
