import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminMaintenanceRequests from "./AdminMaintenanceRequests";

describe("AdminMaintenanceRequests - pagina svuotata in vista di 'Super Admin'", () => {
  it("mostra solo il pannello segnaposto, nessuna azione di import/migrazione/cancellazione", () => {
    render(<AdminMaintenanceRequests />);

    expect(screen.getByText("Super Admin")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
