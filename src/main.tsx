import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Launcher } from "./components/Launcher";
import "./App.css";

// The launcher popup loads the same bundle with `?window=launcher` — render
// a different component tree based on that query param.
const isLauncher =
  new URLSearchParams(window.location.search).get("window") === "launcher";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isLauncher ? <Launcher /> : <App />}
  </React.StrictMode>,
);
