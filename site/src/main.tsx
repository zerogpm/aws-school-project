import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import Home from "./routes/Home";
import Timetable from "./routes/Timetable";
import Interviews from "./routes/Interviews";
import Staff from "./routes/Staff";
import NotFound from "./routes/NotFound";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* BrowserRouter, not HashRouter: real paths need CloudFront to serve
        index.html for any unmatched key, which modules/static-site configures
        as a 403/404 -> /index.html rewrite with a 200 status. */}
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Home />} />
          <Route path="timetable" element={<Timetable />} />
          <Route path="interviews" element={<Interviews />} />
          <Route path="staff" element={<Staff />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
