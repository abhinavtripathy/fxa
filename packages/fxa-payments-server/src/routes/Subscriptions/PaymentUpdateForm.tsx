import React, { useCallback, useState } from 'react';
import { Localized } from 'fluent-react';
import dayjs from 'dayjs';
import { formatCurrencyInCents } from '../../lib/formats';
import { useBooleanState, useNonce } from '../../lib/hooks';
import { getErrorMessage } from '../../lib/errors';
import { SelectorReturns } from '../../store/selectors';
import { Customer, CustomerSubscription, Plan } from '../../store/types';
import { metadataFromPlan } from '../../store/utils';
import PaymentForm from '../../components/PaymentForm';
import ErrorMessage from '../../components/ErrorMessage';
import { SubscriptionsProps } from './index';
import * as Amplitude from '../../lib/amplitude';

type PaymentUpdateFormProps = {
  customer: Customer;
  customerSubscription: CustomerSubscription;
  plan: Plan;
  resetUpdatePayment: SubscriptionsProps['resetUpdatePayment'];
  updatePayment: SubscriptionsProps['updatePayment'];
  updatePaymentStatus: SelectorReturns['updatePaymentStatus'];
};

function getBillingDescriptionText(
  name: string,
  amount: number,
  interval: string,
  intervalCount: number,
  date: string
) {
  const pre = `You are billed ${formatCurrencyInCents(amount)}`;
  const post = `for ${name}. Your next payment occurs on ${date}.`;
  switch (interval) {
    case 'day':
      if (intervalCount === 1) return `${pre} daily ${post}`;
      return `${pre} every ${intervalCount} days ${post}`;
    case 'week':
      if (intervalCount === 1) return `${pre} weekly ${post}`;
      return `${pre} every ${intervalCount} weeks ${post}`;
    case 'month':
      if (intervalCount === 1) return `${pre} monthly ${post}`;
      return `${pre} every ${intervalCount} months ${post}`;
    case 'year':
      if (intervalCount === 1) return `${pre} yearly ${post}`;
      return `${pre} every ${intervalCount} years ${post}`;
  }
}

export const PaymentUpdateForm = ({
  updatePayment: updatePaymentBase,
  updatePaymentStatus,
  resetUpdatePayment: resetUpdatePaymentBase,
  customer,
  customerSubscription,
  plan,
}: PaymentUpdateFormProps) => {
  const [submitNonce, refreshSubmitNonce] = useNonce();
  const [updateRevealed, revealUpdate, hideUpdate] = useBooleanState();
  const [createTokenError, setCreateTokenError] = useState({
    type: '',
    error: false,
  });

  const resetUpdatePayment = useCallback(async () => {
    resetUpdatePaymentBase();
    refreshSubmitNonce();
  }, [resetUpdatePaymentBase, refreshSubmitNonce]);

  const updatePayment = useCallback(
    async (...args: Parameters<typeof updatePaymentBase>) => {
      await updatePaymentBase(...args);
      refreshSubmitNonce();
    },
    [updatePaymentBase, refreshSubmitNonce]
  );

  const onRevealUpdateClick = useCallback(() => {
    resetUpdatePayment();
    revealUpdate();
  }, [resetUpdatePayment, revealUpdate]);

  const onPayment = useCallback(
    (tokenResponse: stripe.TokenResponse) => {
      if (tokenResponse && tokenResponse.token) {
        updatePayment(tokenResponse.token.id, plan);
      } else {
        // This shouldn't happen with a successful createToken() call, but let's
        // display an error in case it does.
        const error: any = { type: 'api_error', error: true };
        setCreateTokenError(error);
      }
    },
    [updatePayment, setCreateTokenError, plan]
  );

  const onPaymentError = useCallback(
    (error: any) => {
      error.error = true;
      setCreateTokenError(error);
    },
    [setCreateTokenError]
  );

  // clear any error rendered with `ErrorMessage`
  const onChange = useCallback(() => {
    setCreateTokenError({ type: '', error: false });
    resetUpdatePayment();
  }, [setCreateTokenError, resetUpdatePayment]);

  const onFormMounted = useCallback(
    () => Amplitude.updatePaymentMounted(plan),
    [plan]
  );

  const onFormEngaged = useCallback(
    () => Amplitude.updatePaymentEngaged(plan),
    [plan]
  );

  const inProgress = updatePaymentStatus.loading;

  const { upgradeCTA } = metadataFromPlan(plan);

  const { last4, exp_month, exp_year } = customer;

  // TODO: date formats will need i18n someday
  const periodEndDate = dayjs
    .unix(customerSubscription.current_period_end)
    .format('MM/DD/YYYY');

  // https://github.com/iamkun/dayjs/issues/639
  const expirationDate = dayjs()
    .set('month', Number(exp_month) - 1)
    .set('year', Number(exp_year))
    .format('MMMM YYYY');

  const billingDescriptionText = getBillingDescriptionText(
    plan.product_name,
    plan.amount,
    plan.interval,
    plan.interval_count,
    periodEndDate
  );

  return (
    <div className="payment-update">
      <h3 className="billing-title">
        <Localized id="sub-update-title">
          <span className="title">Billing Information</span>
        </Localized>
      </h3>
      <Localized
        id={`pay-update-billing-description-${plan.interval}`}
        $amount={formatCurrencyInCents(plan.amount)}
        $intervalCount={plan.interval_count}
        $name={plan.product_name}
        $date={periodEndDate}
      >
        <p className="billing-description">{billingDescriptionText}</p>
      </Localized>
      {upgradeCTA && (
        <p
          className="upgrade-cta"
          data-testid="upgrade-cta"
          dangerouslySetInnerHTML={{ __html: upgradeCTA }}
        />
      )}
      {!updateRevealed ? (
        <div className="with-settings-button">
          <div className="card-details">
            {/* TODO: Need to find a way to display a card icon here? */}
            <Localized id="sub-update-card-ending" $last={last4}>
              <div className="last-four">Card ending {last4}</div>
            </Localized>
            <Localized
              id="pay-update-card-exp"
              $expirationDate={expirationDate}
            >
              <div data-testid="card-expiration-date" className="expiry">
                Expires {expirationDate}
              </div>
            </Localized>
          </div>
          <div className="action">
            <button
              data-testid="reveal-payment-update-button"
              className="settings-button"
              onClick={onRevealUpdateClick}
            >
              <Localized id="pay-update-change-btn">
                <span className="change-button">Change</span>
              </Localized>
            </button>
          </div>
        </div>
      ) : (
        <>
          <ErrorMessage isVisible={!!createTokenError.error}>
            {createTokenError.error && (
              <p data-testid="error-payment-submission">
                {getErrorMessage(createTokenError.type)}
              </p>
            )}
          </ErrorMessage>

          <ErrorMessage isVisible={!!updatePaymentStatus.error}>
            {updatePaymentStatus.error && (
              <p data-testid="error-billing-update">
                {updatePaymentStatus.error.message}
              </p>
            )}
          </ErrorMessage>

          <PaymentForm
            {...{
              submitNonce,
              plan,
              onPayment,
              onPaymentError,
              inProgress,
              confirm: false,
              onCancel: hideUpdate,
              onChange,
              onMounted: onFormMounted,
              onEngaged: onFormEngaged,
            }}
          />
        </>
      )}
    </div>
  );
};

export default PaymentUpdateForm;
