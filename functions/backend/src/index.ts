import {initializeApp} from "firebase-admin/app";

initializeApp();

export {createDeviceRequest} from "./device/createDeviceRequest";
export {createDeviceRequestInternal} from "./device/createDeviceRequestInternal";
export {changeStatus} from "./device/changeStatus";
export {assignVolunteer} from "./device/assignVolunteer";
export { register, checkRegistration, completeRegistration, registerWithIntegratedAuth, doLogin } from "./auth/register";
export { setPassword } from "./auth/setPassword";
export { activateVolunteers, deactivateVolunteers } from "./volunteer/volunteerState";
export { updateVolunteerProfile } from "./volunteer/updateVolunteerProfile";
export { addPrinter } from "./volunteer/addPrinter";
export { inviteVolunteer } from "./volunteer/invite";
export { acceptVolunteerConsents } from "./volunteer/acceptVolunteerConsents";
export { setUserRole } from "./volunteer/setUserRole";
export { listVolunteerAdminData } from "./volunteer/listVolunteerAdminData";
export { createShipmentRequest, approveShipmentRequest, deleteShipmentRequest } from "./shipments/shipmentRequests";
export { saveGlobalMessage } from "./device/saveGlobalMessage";
export { updateChecklist } from "./organizer/updateChecklist";
export { getChecklist } from "./organizer/getChecklist";
export { createChecklist } from "./organizer/createChecklist";
export { createTemplate } from "./organizer/createTemplate";
export { deleteChecklist } from "./organizer/deleteChecklist";
export { addChecklistItem } from "./organizer/addChecklistItem";
export { updateChecklistItem } from "./organizer/updateChecklistItem";
export { removeChecklistItem } from "./organizer/removeChecklistItem";

console.log("REGISTER BUILD SUCCESSFUL - " + new Date().toISOString());
