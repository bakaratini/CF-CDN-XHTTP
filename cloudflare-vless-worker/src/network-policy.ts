import ipaddr from "ipaddr.js";

export interface Destination {
  hostname: string;
  port: number;
}

export type DestinationCheck =
  | { allowed: true; hostname: string; port: number }
  | { allowed: false; reason: string };

const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".test", ".invalid", ".example"];

function isPublicIp(hostname: string): boolean {
  if (!ipaddr.isValid(hostname)) return false;
  try {
    return ipaddr.parse(hostname).range() === "unicast";
  } catch {
    return false;
  }
}

function isPrivateName(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    LOCAL_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix))
  );
}

export function checkDestination(
  destination: Destination,
  originHostname: string,
): DestinationCheck {
  const hostname = destination.hostname.toLowerCase().replace(/\.$/, "");
  const { port } = destination;

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return { allowed: false, reason: "invalid-port" };
  }
  if (port === 25) return { allowed: false, reason: "prohibited-port" };
  if (!hostname || hostname === originHostname.toLowerCase().replace(/\.$/, "")) {
    return { allowed: false, reason: "self-destination" };
  }
  if (isPrivateName(hostname)) {
    return { allowed: false, reason: "non-public-hostname" };
  }

  if (ipaddr.isValid(hostname)) {
    if (!isPublicIp(hostname)) {
      return { allowed: false, reason: "non-public-address" };
    }
    return { allowed: true, hostname, port };
  }

  return { allowed: true, hostname, port };
}
