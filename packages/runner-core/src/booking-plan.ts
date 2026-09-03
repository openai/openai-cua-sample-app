import { type BrowserSession } from "@cua-sample/browser-runtime";

export type BookingRequest = {
  checkIn: string;
  checkOut: string;
  guestEmail: string;
  guestName: string;
  hotelId: string;
  hotelName: string;
  neighborhood: string;
  requireBreakfast: boolean;
  requireWorkspace: boolean;
  specialRequest: string;
};

export type BookingFilters = {
  neighborhood: string;
  requireBreakfast: boolean;
  requireWorkspace: boolean;
};

export type BookingConfirmation =
  | {
      checkIn: string;
      checkOut: string;
      guestEmail: string;
      guestName: string;
      hotelId: string;
      hotelName: string;
      specialRequest: string;
    }
  | null;

const hotelCatalog = {
  "ember lane hotel": {
    hotelId: "ember_lane",
    hotelName: "Ember Lane Hotel",
    neighborhood: "Mission Bay",
  },
  "luma harbor hotel": {
    hotelId: "luma_harbor",
    hotelName: "Luma Harbor Hotel",
    neighborhood: "Marina District",
  },
  "port exchange inn": {
    hotelId: "port_exchange",
    hotelName: "Port Exchange Inn",
    neighborhood: "Embarcadero",
  },
} as const;

function normalizePromptLine(line: string) {
  return line.trim();
}

function readPromptField(prompt: string, field: string) {
  const line = prompt
    .split("\n")
    .map(normalizePromptLine)
    .find((value) => value.toLowerCase().startsWith(`${field.toLowerCase()}:`));

  if (!line) {
    return null;
  }

  return line.slice(line.indexOf(":") + 1).trim();
}

function requirePromptField(prompt: string, field: string) {
  const value = readPromptField(prompt, field);

  if (!value) {
    throw new Error(`Booking prompt must include a "${field}:" line.`);
  }

  return value;
}

function parseHotel(prompt: string) {
  const hotelName = requirePromptField(prompt, "hotel");
  const hotel = hotelCatalog[hotelName.toLowerCase() as keyof typeof hotelCatalog];

  if (!hotel) {
    throw new Error(`Booking prompt references unsupported hotel "${hotelName}".`);
  }

  return hotel;
}

function parseRequires(prompt: string) {
  const raw = readPromptField(prompt, "requires")?.toLowerCase() ?? "";

  return {
    requireBreakfast: raw.includes("breakfast"),
    requireWorkspace: raw.includes("workspace"),
  };
}

export function parseBookingRequest(prompt: string): BookingRequest {
  const hotel = parseHotel(prompt);
  const neighborhood = readPromptField(prompt, "neighborhood") ?? hotel.neighborhood;
  const checkIn = requirePromptField(prompt, "check_in");
  const checkOut = requirePromptField(prompt, "check_out");
  const guestName = requirePromptField(prompt, "guest_name");
  const guestEmail = requirePromptField(prompt, "guest_email");
  const specialRequest = requirePromptField(prompt, "special_request");
  const requirements = parseRequires(prompt);

  return {
    checkIn,
    checkOut,
    guestEmail,
    guestName,
    hotelId: hotel.hotelId,
    hotelName: hotel.hotelName,
    neighborhood,
    requireBreakfast: requirements.requireBreakfast,
    requireWorkspace: requirements.requireWorkspace,
    specialRequest,
  };
}

function formatBookingRecord(input: BookingRequest | Exclude<BookingConfirmation, null>) {
  return [
    `hotel=${input.hotelName}`,
    `guest=${input.guestName}`,
    `email=${input.guestEmail}`,
    `dates=${input.checkIn}->${input.checkOut}`,
    `request=${input.specialRequest}`,
  ].join(" | ");
}

export function buildBookingRunnerPrompt(prompt: string) {
  return prompt.trim();
}

export function buildBookingCodeInstructions(currentUrl: string) {
  return [
    "You are operating a persistent Playwright browser session for a GPT-5.4 CUA demo harness.",
    "You must use the exec_js tool before you answer.",
    `The booking app is already open at ${currentUrl}.`,
    "Use only the operator prompt as the source of truth.",
    "Apply the requested search filters, select the requested hotel, complete the reservation form, and confirm the booking.",
    "Only finish when the reservation panel shows the booking as confirmed.",
    "Reply briefly once the booking is confirmed.",
  ].join("\n");
}

async function readBookingValue<T>(
  session: BrowserSession,
  accessorName:
    | "__bookingReadConfirmation"
    | "__bookingReadFilters",
) {
  return session.page.evaluate((name) => {
    const scope = globalThis as unknown as Record<string, (() => T) | undefined>;
    const accessor = scope[name];

    if (typeof accessor !== "function") {
      throw new Error(`Booking accessor ${name} is unavailable.`);
    }

    return accessor();
  }, accessorName);
}

export async function readBookingConfirmation(session: BrowserSession) {
  return readBookingValue<BookingConfirmation>(session, "__bookingReadConfirmation");
}

export async function readBookingFilters(session: BrowserSession) {
  return readBookingValue<BookingFilters>(session, "__bookingReadFilters");
}

export async function assertBookingOutcome(session: BrowserSession, prompt: string) {
  const request = parseBookingRequest(prompt);

  await session.page.waitForFunction(() => {
    const scope = globalThis as unknown as {
      __bookingLabReady?: boolean;
      __bookingReadConfirmation?: () => BookingConfirmation;
    };

    return (
      scope.__bookingLabReady === true &&
      typeof scope.__bookingReadConfirmation === "function" &&
      scope.__bookingReadConfirmation() !== null
    );
  });

  const [filters, confirmation, statusText] = await Promise.all([
    readBookingFilters(session),
    readBookingConfirmation(session),
    session.page.locator("[data-testid='booking-status']").textContent(),
  ]);

  if (!confirmation) {
    throw new Error("Booking verification failed. No confirmation record was present.");
  }

  if (
    confirmation.hotelId !== request.hotelId ||
    confirmation.guestName !== request.guestName ||
    confirmation.guestEmail !== request.guestEmail ||
    confirmation.checkIn !== request.checkIn ||
    confirmation.checkOut !== request.checkOut ||
    confirmation.specialRequest !== request.specialRequest
  ) {
    throw new Error(
      [
        "Booking verification failed.",
        `Expected ${formatBookingRecord(request)}.`,
        `Observed ${formatBookingRecord(confirmation)}.`,
      ].join(" "),
    );
  }

  if (
    filters.neighborhood !== request.neighborhood ||
    filters.requireBreakfast !== request.requireBreakfast ||
    filters.requireWorkspace !== request.requireWorkspace
  ) {
    throw new Error(
      [
        "Booking verification failed. Applied filters did not match the operator prompt.",
        `Observed neighborhood=${filters.neighborhood || "<any>"} breakfast=${String(filters.requireBreakfast)} workspace=${String(filters.requireWorkspace)}.`,
      ].join(" "),
    );
  }

  if (statusText?.trim() !== "Reservation recorded") {
    throw new Error(
      `Booking verification failed. Status chip read "${statusText?.trim() ?? "<empty>"}".`,
    );
  }
}
