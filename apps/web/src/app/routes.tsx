import { createBrowserRouter } from "react-router";
import { MainPage } from "../features/main/MainPage";
import { TicketsPage } from "../features/tickets/TicketsPage";
import { Shell } from "./Shell";

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: <MainPage /> },
      { path: "/tickets", element: <TicketsPage /> },
    ],
  },
]);
