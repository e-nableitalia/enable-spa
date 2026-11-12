import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PendingVolunteers from "./PendingVolunteers";

vi.mock("../../../firebase", () => ({ functions: {} }));
const callable = vi.fn();
vi.mock("firebase/functions", () => ({ httpsCallable: () => callable }));

const volunteers = [
  { id: "u1", firstName: "Luca", lastName: "Bianchi", email: "luca@example.org", city: "Milano" },
];

describe("PendingVolunteers - dettaglio", () => {
  it("mostra l'icona occhio e apre il dettaglio con i dati estesi senza attivare il volontario", async () => {
    callable.mockResolvedValueOnce({
      data: {
        volunteers: [
          {
            uid: "u1",
            core: { active: false, email: "luca@example.org", role: "volunteer" },
            privateProfile: { firstName: "Luca", lastName: "Bianchi", city: "Milano", consentPrivacy: true },
            skills: { mainInterest: [], enableInterestAreas: [] },
            printers: [],
            publicProfile: { showInVolunteerList: false },
          },
        ],
      },
    });

    render(<PendingVolunteers volunteers={volunteers} />);
    fireEvent.click(screen.getByRole("button", { name: "Apri dettaglio" }));

    await waitFor(() => expect(screen.getByText("Dettaglio volontario")).toBeInTheDocument());
    expect(callable).toHaveBeenCalledTimes(1); // solo lettura: nessuna attivazione
  });

  it("se i dati estesi non sono disponibili mostra comunque un dettaglio ridotto", async () => {
    callable.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<PendingVolunteers volunteers={volunteers} />);
    fireEvent.click(screen.getByRole("button", { name: "Apri dettaglio" }));

    await waitFor(() => expect(screen.getByText("Dettaglio volontario")).toBeInTheDocument());
  });
});
