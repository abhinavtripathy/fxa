/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Post verify view that start the process of creating a secondary email via a code.
 */
import _, { assign } from 'underscore';
import Cocktail from 'cocktail';
import FlowEventsMixin from './../../mixins/flow-events-mixin';
import FormView from '../../form';
import ResendMixin from '../../mixins/resend-mixin';
import ServiceMixin from '../../mixins/service-mixin';
import Template from 'templates/post_verify/secondary_email/confirm_secondary_email.mustache';
import preventDefaultThen from '../../decorators/prevent_default_then';
import { MAX_SECONDARY_EMAILS } from '../../../lib/constants';

const CODE_INPUT_SELECTOR = 'input.otp-code';

class ConfirmSecondaryEmail extends FormView {
  template = Template;
  viewName = 'confirm-secondary-email';

  events = assign(this.events, {
    'click #use-different-email': preventDefaultThen('useDifferentEmail'),
  });

  beforeRender() {
    const account = this.getSignedInAccount();
    if (account.isDefault()) {
      return this.replaceCurrentPage('/');
    }

    // You shouldn't be landing on this page if you already have
    // a secondary email anyway, per the check in the previous page,
    // but just to be safe we'll make sure you're not maxed out.
    return account.recoveryEmails().then(emails => {
      if (emails && emails.length >= MAX_SECONDARY_EMAILS) {
        return this.navigate('/settings');
      }
    });
  }

  setInitialContext(context) {
    const email = context.get('secondaryEmail');
    if (!email) {
      return this.replaceCurrentPage(
        '/post_verify/secondary_email/add_secondary_email'
      );
    }

    context.set({
      email,
      escapedEmail: `<span class="email">${_.escape(email)}</span>`,
    });
  }

  resend() {
    const account = this.getSignedInAccount();
    const email = this.model.get('secondaryEmail');
    return account.recoveryEmailSecondaryResendCode(email);
  }

  submit() {
    const account = this.getSignedInAccount();
    const code = this.getElementValue(CODE_INPUT_SELECTOR);
    const email = this.model.get('secondaryEmail');
    return account
      .recoveryEmailSecondaryVerifyCode(email, code)
      .then(() => {
        this.metrics.logUserPreferences('emails', true);
        return this.navigate(
          '/post_verify/secondary_email/verified_secondary_email',
          {
            secondaryEmail: email,
          }
        );
      })
      .catch(err => this.showValidationError(this.$(CODE_INPUT_SELECTOR), err));
  }

  useDifferentEmail() {
    // To use a different email, we first must delete the old unverified email
    const account = this.getSignedInAccount();
    const secondaryEmail = this.model.get('secondaryEmail');
    return account.recoveryEmailDestroy(secondaryEmail).then(() => {
      this.navigate('/post_verify/secondary_email/add_secondary_email');
    });
  }
}

Cocktail.mixin(
  ConfirmSecondaryEmail,
  FlowEventsMixin,
  ResendMixin(),
  ServiceMixin
);

export default ConfirmSecondaryEmail;
