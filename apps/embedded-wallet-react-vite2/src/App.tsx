import "./App.css";
import { SessionContextProvider } from "@/contexts/SessionContext.tsx";
import Navbar from "@/components/Navbar.tsx";
import { JobListings } from "@/components/JobListings.tsx";
import { RequireUserLoggedIn } from "@/components/RequireUserLoggedIn.tsx";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { JobListingDrilldown } from "@/components/JobListingDrilldown.tsx";

const router = createBrowserRouter([
  {
    path: "/",
    element: <JobListings />,
  },
  {
    path: "/listing/:listingId",
    element: <JobListingDrilldown />,
  },
]);

function App() {
  return (
    <SessionContextProvider>
      <Navbar />
      <div className={"container mx-auto"}>
        <RequireUserLoggedIn>
          <RouterProvider router={router} />
        </RequireUserLoggedIn>
      </div>
    </SessionContextProvider>
  );
}

export default App;
