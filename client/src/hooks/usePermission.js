import { useAuthStore } from '@/app/store';
import { capabilitiesForRole, permissionToCapability, ROLE_CAPABILITIES } from '@/app/permissions';

export const usePermission = () => {
  const user = useAuthStore((s) => s.user);

  const can = (permissionCode) =>
    user?.permissions?.includes(permissionCode) ?? false;

  const hasCapability = (capability) => {
    if (!user?.role) return false;
    if (capabilitiesForRole(user.role).has(capability)) return true;

    return (user.permissions ?? []).some(
      (permission) => permissionToCapability[permission] === capability
    );
  };

  const hasRole = (...roles) =>
    roles.includes(user?.role);

  const isAtLeast = (role) => {
    const roles = Object.keys(ROLE_CAPABILITIES);
    return roles.indexOf(user?.role) <= roles.indexOf(role);
  };

  return { can, hasCapability, hasRole, isAtLeast, user };
};
