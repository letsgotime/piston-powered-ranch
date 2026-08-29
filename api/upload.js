import { handleUpload } from "@vercel/blob/client";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { verifySession, sessionSecret } from "./upload-session.js";

/**
 * Mints short-lived, scoped upload tokens for the public Submit form.
 *
 * The store is PRIVATE by design: submitted vehicle photos routinely contain
 * license plates and VINs in the pixels, and those must never be readable from
 * a guessable URL. Reads go through /api/media.js, which requires staff auth.
 *
 * This endpoint is deliberately reachable without login. The Submit form is
 * public by requirement. Everything below is therefore a hard limit enforced
 * server-side, not a client-side courtesy.
 */

const KINDS = {
  photo: {
    max: 25 * 1024 * 1024,
    types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"],
  },
  video: {
    max: 600 * 1024 * 1024,
    types: ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v", "video/mpeg"],
  },
  voice: {
    max: 60 * 1024 * 1024,
    types: ["audio/webm", "audio/mp4", "audio/mpeg", "audio/aac", "audio/wav", "audio/x-m4a"],
  },
  doc: {
    max: 50 * 1024 * 1024,
    types: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
      "text/csv",
      "image/jpeg",
      "image/png",
      "application/zip",
    ],
  },
};

/**
 * Chat carries different limits from the public Submit form.
 *
 * Gavin asked for 50 photos, five minutes of video, five minutes of voice and
 * any document type. Duration is not something this endpoint can measure, so
 * it is enforced in the composer and backed here by a byte ceiling generous
 * enough for five minutes at phone bitrates: roughly 30 MB/min for 1080p and a
 * great deal less for voice.
 *
 * "Any document type" is taken literally, which is only safe because this
 * scope demands a verified staff token, writes to a private store, and is read
 * back exclusively through /api/media.js. Nothing here is ever served from a
 * guessable URL, and nothing is executed. The cap is size, not type.
 */
const CHAT_KINDS = {
  photo: { max: 25 * 1024 * 1024, types: KINDS.photo.types },
  video: { max: 400 * 1024 * 1024, types: KINDS.video.types },
  voice: { max: 40 * 1024 * 1024, types: KINDS.voice.types },
  doc: { max: 100 * 1024 * 1024, types: null },
};

const SUBMISSION_TYPES = new Set(["vehicle", "vendor", "sponsor"]);

/**
 * Workbench attachments are a second, separate scope on this endpoint.
 *
 * The submissions scope below is deliberately open, because the Submit form is
 * public. The workbench is not: it is internal working material, so this scope
 * demands a verified Neon Auth token on a staff address before it will mint a
 * token, and confines that token to one workbench item's folder.
 */
const DATA_API =
  "https://ep-broad-truth-auz9r4ir.apirest.c-10.us-east-1.aws.neon.tech/neondb/rest/v1";

/**
 * Authorisation comes from public.staff_allowlist, never from a list in code.
 * The token is verified cryptographically first; this then replays it against
 * is_staff() so the function and the row-level policy read one table.
 */
async function isStaff(bearer) {
  let res;
  try {
    res = await fetch(`${DATA_API}/rpc/is_staff`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    return false;
  }
  if (!res.ok) return false;
  return (await res.text()).trim() === "true";
}

const JWKS = createRemoteJWKSet(
  new URL(
    "https://ep-broad-truth-auz9r4ir.neonauth.c-10.us-east-1.aws.neon.tech/neondb/auth/.well-known/jwks.json",
  ),
);

async function staffEmail(token) {
  if (!token) return "";
  try {
    const { payload } = await jwtVerify(String(token), JWKS);
    const email = String(payload.email || payload.sub_email || "").toLowerCase();
    return (await isStaff(String(token))) ? email : "";
  } catch {
    return "";
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const json = await handleUpload({
      request,
      body: request.body,

      onBeforeGenerateToken: async (pathname, clientPayloadRaw) => {
        let payload = {};
        try {
          payload = JSON.parse(clientPayloadRaw || "{}");
        } catch {
          throw new Error("Malformed clientPayload");
        }

        const kind = KINDS[payload.kind];
        if (!kind) throw new Error("Unknown upload kind");

        // Workbench scope: staff only, and pinned to one item's folder.
        if (payload.scope === "workbench") {
          const email = await staffEmail(payload.token);
          if (!email) throw new Error("Sign in as staff to attach files to the workbench");
          const item = String(payload.itemId || "").replace(/[^a-zA-Z0-9-]/g, "");
          if (item.length < 8 || item.length > 64) throw new Error("Invalid workbench item");
          const wanted = `workbench/${item}/${payload.kind}/`;
          if (!pathname.startsWith(wanted) || pathname.includes("..")) {
            throw new Error("Upload path is not allowed for this token");
          }
          return {
            allowedContentTypes: kind.types,
            maximumSizeInBytes: kind.max,
            addRandomSuffix: true,
            tokenPayload: JSON.stringify({ scope: "workbench", kind: payload.kind, item, by: email }),
          };
        }

        // Chat scope: staff only, pinned to the sender's own folder, so a
        // leaked token can write into nobody else's history.
        if (payload.scope === "chat") {
          const email = await staffEmail(payload.token);
          if (!email) throw new Error("Sign in as staff to attach files to chat");
          const chatKind = CHAT_KINDS[payload.kind];
          if (!chatKind) throw new Error("Unknown upload kind");
          const who = email.replace(/[^a-z0-9]+/g, "-");
          const draft = String(payload.draftId || "").replace(/[^a-zA-Z0-9_-]/g, "");
          if (draft.length < 8 || draft.length > 64) throw new Error("Invalid draft id");
          const wanted = `chat/${who}/${draft}/${payload.kind}/`;
          if (!pathname.startsWith(wanted) || pathname.includes("..")) {
            throw new Error("Upload path is not allowed for this token");
          }
          return {
            allowedContentTypes: chatKind.types || undefined,
            maximumSizeInBytes: chatKind.max,
            addRandomSuffix: true,
            tokenPayload: JSON.stringify({ scope: "chat", kind: payload.kind, by: email }),
          };
        }

        // Avatar scope: staff only, one folder per person, photos only.
        if (payload.scope === "avatar") {
          const email = await staffEmail(payload.token);
          if (!email) throw new Error("Sign in as staff to set a picture");
          const who = email.replace(/[^a-z0-9]+/g, "-");
          const wanted = `avatars/${who}/`;
          if (!pathname.startsWith(wanted) || pathname.includes("..")) {
            throw new Error("Upload path is not allowed for this token");
          }
          return {
            allowedContentTypes: KINDS.photo.types,
            maximumSizeInBytes: 12 * 1024 * 1024,
            addRandomSuffix: true,
            tokenPayload: JSON.stringify({ scope: "avatar", by: email }),
          };
        }

        // Bot gate. Enforced only once TURNSTILE_SECRET exists, so this ships
        // inert and turns on with configuration rather than a code change.
        const gateOn = Boolean(process.env.TURNSTILE_SECRET);
        if (gateOn) {
          const session = verifySession(payload.session, sessionSecret());
          if (!session) throw new Error("Verification required. Refresh the form and try again");
          if (session.d !== String(payload.draftId || "")) {
            throw new Error("Session does not match this submission");
          }
        }

        const submissionType = SUBMISSION_TYPES.has(payload.submissionType)
          ? payload.submissionType
          : "vehicle";

        // Namespace by submission type and draft id so one submitter's files
        // stay grouped, and a stray token can't be aimed anywhere else.
        const draft = String(payload.draftId || "").replace(/[^a-zA-Z0-9_-]/g, "");
        if (draft.length < 8 || draft.length > 64) throw new Error("Invalid draft id");

        // The client builds the path; the server's job is to prove it is the
        // path this token is allowed to write. onBeforeGenerateToken cannot
        // rewrite pathname, so validating it is what actually constrains a
        // leaked token to one submitter's own folder.
        const expected = `submissions/${submissionType}/${draft}/${payload.kind}/`;
        if (!pathname.startsWith(expected)) {
          throw new Error("Upload path is not allowed for this token");
        }
        if (pathname.includes("..")) throw new Error("Invalid upload path");

        return {
          allowedContentTypes: kind.types,
          maximumSizeInBytes: kind.max,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ kind: payload.kind, submissionType, draft }),
        };
      },

      // Nothing to persist here: the client writes the finished manifest into
      // submissions.details when the form is actually submitted. Files uploaded
      // for an abandoned draft are orphans and get swept separately.
      onUploadCompleted: async () => {},
    });

    return response.status(200).json(json);
  } catch (error) {
    return response.status(400).json({ error: error?.message || "Upload rejected" });
  }
}
