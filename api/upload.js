import { handleUpload } from "@vercel/blob/client";
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

const SUBMISSION_TYPES = new Set(["vehicle", "vendor", "sponsor"]);

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
