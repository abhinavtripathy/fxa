/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
import * as crypto from "./crypto";
import * as hawk from "./hawk";
import { xor, hexToUint8, uint8ToHex } from "./utils";

const ERRORS = {
  INVALID_TIMESTAMP: 111,
  INCORRECT_EMAIL_CASE: 120
};

export default class AuthClient {
  static VERSION = "v1";
  private uri: string;

  constructor(authServerUri: string) {
    if (new RegExp(`/${AuthClient.VERSION}$`).test(authServerUri)) {
      this.uri = authServerUri;
    } else {
      this.uri = `${authServerUri}/${AuthClient.VERSION}`;
    }
  }

  private url(path: string) {
    return `${this.uri}${path}`;
  }

  private async request(
    method: string,
    path: string,
    jsonPayload: any,
    options?: any
  ): Promise<any> {
    return {};
  }

  private async hawkRequest(
    method: string,
    path: string,
    token: string,
    kind: string,
    payload: any = null
  ) {
    const credentials = await hawk.deriveHawkCredentials(token, kind);
    const authorization = await hawk.header(method, this.url(path), {
      credentials,
      payload: payload ? JSON.stringify(payload) : null,
      contentType: "application/json"
    });
    const headers = {
      authorization,
      "Content-Type": "application/json"
    };
    return this.request(method, path, payload, { headers });
  }

  private async sessionGet(path: string, sessionToken: string) {
    return this.hawkRequest("GET", path, sessionToken, "sessionToken");
  }

  private async sessionPost(path: string, sessionToken: string, payload: any) {
    return this.hawkRequest(
      "POST",
      path,
      sessionToken,
      "sessionToken",
      payload
    );
  }

  async signUp(email: string, password: string, options: any) {
    const credentials = await crypto.getCredentials(email, password);
    const payload = {
      email,
      authPW: credentials.authPW
    };
    // TODO options
    const accountData = await this.request("POST", "/account/create", payload);
    if (options.keys) {
      accountData.unwrapBKey = credentials.unwrapBKey;
    }
    return accountData;
  }

  async signIn(email: string, password: string, options: any): Promise<any> {
    //TODO return type
    const credentials = await crypto.getCredentials(email, password);
    const payload = {
      email,
      authPW: credentials.authPW
    };
    // TODO options
    try {
      const accountData = await this.request("POST", "/account/login", payload);
      if (options.keys) {
        accountData.unwrapBKey = credentials.unwrapBKey;
      }
      return accountData;
    } catch (error) {
      if (
        error &&
        error.email &&
        error.errno === ERRORS.INCORRECT_EMAIL_CASE &&
        !options.skipCaseError
      ) {
        options.skipCaseError = true;
        options.originalLoginEmail = email;

        return this.signIn(error.email, password, options);
      } else {
        throw error;
      }
    }
  }

  async verifyCode(uid: string, code: string, options: any) {
    // TODO options
    return this.request("POST", "/recovery_email/verify_code", { uid, code });
  }

  async recoveryEmailStatus(sessionToken: string) {
    return this.sessionGet("/recovery_email/status", sessionToken);
  }

  async recoveryEmailResendCode(sessionToken: string, options: any) {
    //TODO options
    return this.sessionPost("/recovery_email/resend_code", sessionToken, {});
  }

  async passwordForgotSendCode(email: string, options: any) {
    const payload = {
      email
    };
    // TODO options
    return this.request("POST", "/password/forgot/send_code", payload);
  }

  async passwordForgotResendCode(
    email: string,
    passwordForgotToken: string,
    options: any
  ) {
    const payload = {
      email
    };
    // TODO options
    return this.hawkRequest(
      "POST",
      "/password/forgot/resend_code",
      passwordForgotToken,
      "passwordForgotToken",
      payload
    );
  }

  async passwordForgotVerifyCode(
    code: string,
    passwordForgotToken: string,
    options: any
  ) {
    const payload = {
      code
    };
    // TODO options
    return this.hawkRequest(
      "POST",
      "/password/forgot/verify_code",
      passwordForgotToken,
      "passwordForgotToken",
      payload
    );
  }

  async passwordForgotStatus(passwordForgotToken: string) {
    return this.hawkRequest(
      "GET",
      "/password/forgot/status",
      passwordForgotToken,
      "passwordForgotToken"
    );
  }

  async accountReset(
    email: string,
    newPassword: string,
    accountResetToken: string,
    options: any
  ) {
    const credentials = await crypto.getCredentials(email, newPassword);
    // TODO
  }

  async accountKeys(keyFetchToken: string, oldUnwrapBKey: string) {
    const credentials = await hawk.deriveHawkCredentials(
      keyFetchToken,
      "keyFetchToken"
    );
    const keyData = await this.hawkRequest(
      "GET",
      "/account/keys",
      keyFetchToken,
      "keyFetchToken"
    );
    const keys = await crypto.unbundleKeyFetchResponse(
      credentials.bundleKey,
      keyData.bundle
    );
    // TODO move this xor into crypto.ts
    return {
      kA: keys.kA,
      kB: uint8ToHex(xor(hexToUint8(keys.wrapKB), hexToUint8(oldUnwrapBKey)))
    };
  }

  async accountDestroy(
    email: string,
    password: string,
    options: any,
    sessionToken?: string
  ): Promise<any> {
    //TODO return type
    const credentials = await crypto.getCredentials(email, password);
    const payload = {
      email,
      authPW: credentials.authPW
    };
    try {
      if (sessionToken) {
        return this.sessionPost("/account/destroy", sessionToken, payload);
      } else {
        return this.request("POST", "/account/destroy", payload);
      }
    } catch (error) {
      if (
        error &&
        error.email &&
        error.errno === ERRORS.INCORRECT_EMAIL_CASE &&
        !options.skipCaseError
      ) {
        options.skipCaseError = true;

        return this.accountDestroy(
          error.email,
          password,
          options,
          sessionToken
        );
      } else {
        throw error;
      }
    }
  }

  async accountStatus(uid: string) {
    return this.request("GET", `/account/status?uid=${uid}`, null);
  }

  async accountStatusByEmail(email: string) {
    return this.request("POST", "/account/status", { email });
  }

  async accountProfile(sessionToken: string) {
    return this.sessionGet("/account/profile", sessionToken);
  }

  async account(sessionToken: string) {
    return this.sessionGet("/account", sessionToken);
  }

  async sessionDestroy(sessionToken: string, options: any) {
    // TODO options
    return this.sessionPost("/session/destoy", sessionToken, options);
  }

  async sessionStatus(sessionToken: string) {
    return this.sessionGet("/session/status", sessionToken);
  }

  async sessionVerifyCode(sessionToken: string, code: string, options: any) {
    //TODO options
    return this.sessionPost("/session/verify_code", sessionToken, { code });
  }

  async sessionResendVerifyCode(sessionToken: string) {
    return this.sessionPost("/session/resend_code", sessionToken, {});
  }

  async sessionReauth(
    sessionToken: string,
    email: string,
    password: string,
    options: any
  ): Promise<any> {
    //TODO return type
    const credentials = await crypto.getCredentials(email, password);
    // TODO options
    const payload = {
      email,
      authPW: credentials.authPW
    };
    try {
      const accountData = await this.sessionPost(
        "/session/reauth",
        sessionToken,
        payload
      );
      if (options.keys) {
        accountData.unwrapBKey = credentials.unwrapBKey;
      }
      return accountData;
    } catch (error) {
      if (
        error &&
        error.email &&
        error.errno === ERRORS.INCORRECT_EMAIL_CASE &&
        !options.skipCaseError
      ) {
        options.skipCaseError = true;
        options.originalLoginEmail = email;

        return this.sessionReauth(sessionToken, error.email, password, options);
      } else {
        throw error;
      }
    }
  }

  async certificateSign(
    sessionToken: string,
    publicKey: any,
    duration: number,
    options: any
  ) {
    const payload = {
      publicKey,
      duration
    };
    // TODO options
    return this.sessionPost("/certificate/sign", sessionToken, payload);
  }

  async passwordChange(
    email: string,
    oldPassword: string,
    newPassword: string,
    options: any
  ) {
    const oldCredentials = await crypto.getCredentials(email, oldPassword);
    const passwordData = await this.request("POST", "/password/change/start", {
      email,
      oldAuthPW: oldCredentials.authPW
    });
    // TODO finish
  }

  async getRandomBytes() {
    return this.request("POST", "/get_random_bytes", null);
  }

  async deviceRegister(
    sessionToken: string,
    name: string,
    type: string,
    options: any
  ) {
    // TODO options
    const payload = {
      name,
      type
    };
    return this.sessionPost("/account/device", sessionToken, payload);
  }

  async deviceUpdate(
    sessionToken: string,
    id: string,
    name: string,
    options: any
  ) {
    // TODO options
    const payload = {
      id,
      name
    };
    return this.sessionPost("/account/device", sessionToken, payload);
  }

  async deviceDestroy(sessionToken: string, id: string) {
    return this.sessionPost("/account/device/destroy", sessionToken, { id });
  }

  async deviceList(sessionToken: string) {
    return this.sessionGet("/account/devices", sessionToken);
  }

  async sessions(sessionToken: string) {
    return this.sessionGet("/account/sessions", sessionToken);
  }

  async securityEvents(sessionToken: string) {
    return this.sessionGet("/securityEvents", sessionToken);
  }

  async deleteSecurityEvents(sessionToken: string) {
    return this.hawkRequest(
      "DELETE",
      "/securityEvents",
      sessionToken,
      "sessionToken"
    );
  }

  async attachedClients(sessionToken: string) {
    return this.sessionGet("/account/attached_clients", sessionToken);
  }

  async attachedClientDestroy(sessionToken: string, clientInfo: any) {
    return this.sessionPost("/account/attached_client/destroy", sessionToken, {
      clientId: clientInfo.clientId,
      deviceId: clientInfo.deviceId,
      refreshTokenId: clientInfo.refreshTokenId,
      sessionTokenId: clientInfo.sessionTokenId
    });
  }

  async sendUnblockCode(email: string, options: any) {
    // TODO options
    return this.request("POST", "/account/login/send_unblock_code", { email });
  }

  async rejectUnblockCode(uid: string, unblockCode: string) {
    return this.request("POST", "/account/login/reject_unblock_code", {
      uid,
      unblockCode
    });
  }

  async sendSms(
    sessionToken: string,
    phoneNumber: string,
    messageId: string,
    options: any
  ) {
    // TODO options
    return this.sessionPost("/sms", sessionToken, { phoneNumber, messageId });
  }

  async smsStatus(sessionToken: string, options: any) {
    // TODO
  }

  async consumeSigninCode(
    code: string,
    flowId: string,
    flowBeginTime: number,
    deviceId?: string
  ) {
    return this.request("POST", "/signinCodes/consume", {
      code,
      metricsContext: {
        deviceId,
        flowId,
        flowBeginTime
      }
    });
  }

  async recoveryEmails(sessionToken: string) {
    this.sessionGet("/recovery_emails", sessionToken);
  }

  async recoveryEmailCreate(sessionToken: string, email: string, options: any) {
    // TODO options
    return this.sessionPost("/recovery_email", sessionToken, { email });
  }

  async recoveryEmailDestroy(sessionToken: string, email: string) {
    return this.sessionPost("/recovery_email/destroy", sessionToken, { email });
  }

  async recoveryEmailSetPrimaryEmail(sessionToken: string, email: string) {
    return this.sessionPost("/recovery_email/set_primary", sessionToken, {
      email
    });
  }

  async recoveryEmailSecondaryVerifyCode(
    sessionToken: string,
    email: string,
    code: string
  ) {
    return this.sessionPost(
      "/recovery_email/secondary/verify_code",
      sessionToken,
      { email, code }
    );
  }

  async recoveryEmailSecondaryResendCode(sessionToken: string, email: string) {
    return this.sessionPost(
      "/recovery_email/secondary/resend_code",
      sessionToken,
      { email }
    );
  }

  async createTotpToken(sessionToken: string, options: any) {
    // TODO options
    return this.sessionPost("/totp/create", sessionToken, {});
  }

  async deleteTotpToken(sessionToken: string) {
    return this.sessionPost("/totp/destroy", sessionToken, {});
  }

  async checkTotpTokenExists(sessionToken: string) {
    return this.sessionGet("/totp/exists", sessionToken);
  }

  async verifyTotpCode(sessionToken: string, code: string, options: any) {
    // TODO options
    return this.sessionPost("/session/verify/totp", sessionToken, { code });
  }

  async replaceRecoveryCodes(sessionToken: string) {
    return this.sessionGet("/recoveryCodes", sessionToken);
  }

  async consumeRecoveryCode(sessionToken: string, code: string) {
    return this.sessionPost("/session/verify/recoveryCodes", sessionToken, {
      code
    });
  }

  async createRecoveryKey(
    sessionToken: string,
    recoveryKeyId: string,
    recoveryData: any,
    enabled: boolean
  ) {
    return this.sessionPost("/recoveryKey", sessionToken, {
      recoveryKeyId,
      recoveryData,
      enabled
    });
  }

  async getRecoveryKey(accountResetToken: string, recoveryKeyId: string) {
    return this.hawkRequest(
      "GET",
      `/recoveryKey/${recoveryKeyId}`,
      accountResetToken,
      "accountResetToken"
    );
  }

  async resetPasswordWithRecoveryKey(
    accountResetToken: string,
    email: string,
    newPassword: string,
    recoveryKeyId: string,
    keys: any,
    options: any
  ) {
    const credentials = await crypto.getCredentials(email, newPassword);
    // TODO finish
  }

  async deleteRecoveryKey(sessionToken: string) {
    return this.hawkRequest(
      "DELETE",
      "/recoveryKey",
      sessionToken,
      "sessionToken"
    );
  }

  async recoveryKeyExists(sessionToken: string, email: string) {
    return this.sessionPost("/recoveryKey/exists", sessionToken, { email });
  }

  async verifyRecoveryKey(sessionToken: string, recoveryKeyId: string) {
    return this.sessionPost("/recoveryKey/verify", sessionToken, {
      recoveryKeyId
    });
  }

  async createOAuthCode(
    sessionToken: string,
    clientId: string,
    state: string,
    options: any
  ) {
    return this.sessionPost("/oauth/authorization", sessionToken, {
      access_type: options.access_type,
      acr_values: options.acr_values,
      clientId,
      code_challenge: options.code_challenge,
      code_challenge_method: options.code_challenge_method,
      keys_jwe: options.keys_jwe,
      redirect_uri: options.redirect_uri,
      response_type: options.response_type,
      scope: options.scope,
      state
    });
  }

  async createOAuthToken(sessionToken: string, clientId: string, options: any) {
    return this.sessionPost("/oauth/token", sessionToken, {
      grant_type: "fxa-credentials",
      access_type: options.access_type,
      client_id: clientId,
      scope: options.scope,
      ttl: options.ttl
    });
  }

  async getOAuthScopedKeyData(
    sessionToken: string,
    clientId: string,
    scope: string
  ) {
    return this.sessionPost("/account/scoped-key-data", sessionToken, {
      client_id: clientId,
      scope
    });
  }

  async getSubscriptionPlans(accessToken: string) {
    // TODO finish
  }

  async getActiveSubscriptions(accessToken: string) {
    // TODO finish
  }

  async createSupportTicket(accessToken: string, supportTicket: any) {
    // TODO finish
  }
}
