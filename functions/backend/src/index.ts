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
export { createTask } from "./tasks/createTask";
export { updateTask } from "./tasks/updateTask";
export { changeTaskStatus } from "./tasks/changeTaskStatus";
export { addTaskNote } from "./tasks/addTaskNote";
export { listTasks } from "./tasks/listTasks";
export { deleteTask } from "./tasks/deleteTask";
export { createProject } from "./tasks/createProject";
export { updateProject } from "./tasks/updateProject";
export { listProjects } from "./tasks/listProjects";
export { deleteProject } from "./tasks/deleteProject";
export { listVolunteerOptions } from "./tasks/listVolunteerOptions";
export { createShipmentRequest, approveShipmentRequest, deleteShipmentRequest } from "./shipments/shipmentRequests";
export { saveGlobalMessage } from "./device/saveGlobalMessage";

console.log("REGISTER BUILD SUCCESSFUL - " + new Date().toISOString());
