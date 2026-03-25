import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";
import type { ShippingAddress } from "../types/shippingAddress";
import type { VolunteerPrivateProfile } from "../types/volunteerData";

/**
 * A device request as seen by the shipping address resolver.
 * Subset of deviceRequestData — only the fields needed for address resolution.
 */
export interface ResolvableRequest {
  id: string;
  assignedVolunteers: string[];
  shippingAddress?: ShippingAddress;
}

/**
 * Result of resolveShippingAddresses for a single (volunteer, request) pair.
 *
 * fromAddress — where the device ships FROM (the volunteer's location)
 * toAddress   — where the device ships TO (the recipient's address on the request)
 */
export interface ResolvedAddresses {
  fromAddress: ShippingAddress | null;
  toAddress: ShippingAddress | null;
}

/**
 * Resolves shipping addresses for a volunteer across a list of device requests.
 *
 * fromAddress resolution order:
 *   1. volunteer.shippingAddress from users/{uid}/private/profile
 *   2. shippingAddress from the first assigned request that has one (fallback)
 *
 * toAddress resolution:
 *   1. shippingAddress from the first assigned request that has one
 *
 * @param volunteerId - UID of the volunteer
 * @param requests    - list of device requests to search
 * @returns ResolvedAddresses with null for any address that could not be resolved
 */
export async function resolveShippingAddresses(
  volunteerId: string,
  requests: ResolvableRequest[]
): Promise<ResolvedAddresses> {
  // Filter to only requests actually assigned to this volunteer
  const assignedRequests = requests.filter(
    (r) => r.assignedVolunteers?.includes(volunteerId)
  );

  // toAddress: first assigned request with a shippingAddress
  const toAddress: ShippingAddress | null =
    assignedRequests.find((r) => r.shippingAddress)?.shippingAddress ?? null;

  // fromAddress: try volunteer profile first
  let fromAddress: ShippingAddress | null = null;
  try {
    const profileSnap = await getDoc(
      doc(db, "users", volunteerId, "private", "profile")
    );
    if (profileSnap.exists()) {
      const profile = profileSnap.data() as VolunteerPrivateProfile;
      fromAddress = profile.shippingAddress ?? null;
    }
  } catch {
    // Firestore unavailable — fall through to request-based fallback
  }

  // fromAddress fallback: first assigned request with a shippingAddress
  if (!fromAddress) {
    fromAddress = toAddress;
  }

  return { fromAddress, toAddress };
}
