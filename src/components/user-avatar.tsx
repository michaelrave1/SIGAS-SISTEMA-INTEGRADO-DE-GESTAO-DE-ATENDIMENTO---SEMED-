"use client";

import Image from "next/image";
import { UserRound } from "lucide-react";
import { useState } from "react";

export function UserAvatar({ url }: { url: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <span className="user-avatar" aria-hidden="true">
      {url && url !== failedUrl ? (
        <Image
          src={url}
          alt=""
          width={44}
          height={44}
          unoptimized
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <UserRound size={24} />
      )}
    </span>
  );
}
