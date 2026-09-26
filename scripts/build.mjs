import { rollup } from "rollup";
import config from "../rollup.config.js";

for (const current of Array.isArray(config) ? config : [config]) {
  const bundle = await rollup(current);
  for (const output of Array.isArray(current.output) ? current.output : [current.output]) {
    await bundle.write(output);
  }
  await bundle.close();
}
process.exit(0);
