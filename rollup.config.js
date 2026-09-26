import deckyPlugin from "@decky/rollup";
import importAssets from "rollup-plugin-import-assets";

export default deckyPlugin({
  plugins: [importAssets({ include: [/\.ogg$/i], publicPath: "http://127.0.0.1:1337/plugins/PongBar/" })],
});
