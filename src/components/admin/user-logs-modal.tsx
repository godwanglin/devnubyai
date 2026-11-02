"use client";

import React from "react";
import { Modal } from "@/components/ui/modal";
import { TelemetryLogsView } from "@/components/admin/telemetry-logs-view";
import type { AdminUserListItemDto } from "@/lib/users/types";

export interface UserLogsModalProps {
  user: Pick<AdminUserListItemDto, "id" | "name" | "email" | "publicId"> | null;
  onClose: () => void;
}

export function UserLogsModal({ user, onClose }: UserLogsModalProps) {
  if (!user) return null;

  return (
    <Modal
      isOpen={Boolean(user)}
      onClose={onClose}
      title={`Log Request User — ${user.name}`}
      description={`${user.email} • userid="${user.id}" (Sumber: .logs/)`}
      maxWidth="5xl"
    >
      <div className="max-h-[78vh] overflow-y-auto pr-1">
        <TelemetryLogsView userId={user.id} />
      </div>
    </Modal>
  );
}
