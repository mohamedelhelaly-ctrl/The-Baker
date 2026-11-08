import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import { DisplayProvider } from "./lib/display";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <DisplayProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </DisplayProvider>
    </BrowserRouter>
  </StrictMode>,
);
