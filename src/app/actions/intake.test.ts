import { describe, it, expect } from "vitest";
import { validateIntakeFields, type IntakeFormFields } from "./intake-types";

const validFields: IntakeFormFields = {
  name: "Sarah Jones",
  addressLine1: "14 Oak Street",
  city: "London",
  postcode: "N1 2AB",
  phoneNumber: "+44 7700 900123",
  problemDescription: "Boiler not working, error code E2.",
  additionalDetails: "",
};

describe("validateIntakeFields", () => {
  it("returns null for a fully valid submission", () => {
    expect(validateIntakeFields(validFields)).toBeNull();
  });

  it("returns an error when name is empty", () => {
    const errors = validateIntakeFields({ ...validFields, name: "" });
    expect(errors).not.toBeNull();
    expect(errors?.name).toBeDefined();
  });

  it("returns an error when name is only whitespace", () => {
    const errors = validateIntakeFields({ ...validFields, name: "   " });
    expect(errors?.name).toBeDefined();
  });

  it("returns an error when addressLine1 is empty", () => {
    const errors = validateIntakeFields({ ...validFields, addressLine1: "" });
    expect(errors?.addressLine1).toBeDefined();
  });

  it("returns an error when city is empty", () => {
    const errors = validateIntakeFields({ ...validFields, city: "" });
    expect(errors?.city).toBeDefined();
  });

  it("returns an error when postcode is empty", () => {
    const errors = validateIntakeFields({ ...validFields, postcode: "" });
    expect(errors?.postcode).toBeDefined();
  });

  it("returns an error for an invalid UK postcode", () => {
    const errors = validateIntakeFields({ ...validFields, postcode: "99999" });
    expect(errors?.postcode).toBeDefined();
  });

  it("accepts valid UK postcode formats", () => {
    const postcodes = ["N1 2AB", "SW1A 1AA", "EC1A 1BB", "W1A 0AX", "M1 1AE"];
    for (const postcode of postcodes) {
      expect(validateIntakeFields({ ...validFields, postcode })).toBeNull();
    }
  });

  it("returns an error when phone number is empty", () => {
    const errors = validateIntakeFields({ ...validFields, phoneNumber: "" });
    expect(errors?.phoneNumber).toBeDefined();
  });

  it("returns an error for a phone number that is too short", () => {
    const errors = validateIntakeFields({ ...validFields, phoneNumber: "123" });
    expect(errors?.phoneNumber).toBeDefined();
  });

  it("accepts valid phone number formats", () => {
    const phones = [
      "+44 7700 900123",
      "07700900123",
      "+1-800-555-0199",
      "020 7946 0182",
    ];
    for (const phoneNumber of phones) {
      expect(validateIntakeFields({ ...validFields, phoneNumber })).toBeNull();
    }
  });

  it("returns an error when problemDescription is empty", () => {
    const errors = validateIntakeFields({
      ...validFields,
      problemDescription: "",
    });
    expect(errors?.problemDescription).toBeDefined();
  });

  it("does not require additionalDetails", () => {
    expect(
      validateIntakeFields({ ...validFields, additionalDetails: "" }),
    ).toBeNull();
  });

  it("returns multiple errors at once when multiple fields are invalid", () => {
    const errors = validateIntakeFields({
      ...validFields,
      name: "",
      city: "",
      problemDescription: "",
    });
    expect(errors?.name).toBeDefined();
    expect(errors?.city).toBeDefined();
    expect(errors?.problemDescription).toBeDefined();
  });
});
