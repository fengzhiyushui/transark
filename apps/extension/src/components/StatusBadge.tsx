import React from 'react';
import type { DataPolicy, TranslationProtocol } from '@translate/contracts';
import { ShieldCheck, HardDrive, Network, Globe } from 'lucide-react';

interface PolicyBadgeProps {
  policy: DataPolicy;
}

export const PolicyBadge: React.FC<PolicyBadgeProps> = ({ policy }) => {
  switch (policy) {
    case 'device-only':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
          <HardDrive className="h-3 w-3" />
          <span>设备本地 (离线)</span>
        </span>
      );
    case 'allow-lan':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
          <Network className="h-3 w-3" />
          <span>局域网内网</span>
        </span>
      );
    case 'allow-cloud':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
          <Globe className="h-3 w-3" />
          <span>公网云端</span>
        </span>
      );
    default:
      return null;
  }
};

interface ProtocolBadgeProps {
  protocol: TranslationProtocol;
}

export const ProtocolBadge: React.FC<ProtocolBadgeProps> = ({ protocol }) => {
  return (
    <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono font-medium text-slate-600">
      {protocol}
    </span>
  );
};
