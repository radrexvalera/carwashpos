import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { useTenant } from '@/app/TenantProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { getSettings, updateSettings } from './api/settingsApi'

const settingsSchema = z.object({
  businessName: z.string().min(1, 'Business name is required'),
  address: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().optional(),
  numberingPrefix: z.string().min(1, 'Required').max(10),
  receiptHeader: z.string().optional(),
  receiptFooter: z.string().optional(),
  loyaltyEarnRate: z.coerce.number().min(0, 'Must be 0 or more'),
  loyaltyRedemptionValue: z.coerce.number().min(0, 'Must be 0 or more'),
})

type SettingsFormValues = z.infer<typeof settingsSchema>

export function SettingsPage() {
  const { profile } = useTenant()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      businessName: '',
      address: '',
      contactPhone: '',
      contactEmail: '',
      numberingPrefix: 'CW',
      receiptHeader: '',
      receiptFooter: '',
      loyaltyEarnRate: 1,
      loyaltyRedemptionValue: 0.5,
    },
  })

  useEffect(() => {
    if (!profile) return
    getSettings(profile.tenantId)
      .then((s) =>
        form.reset({
          businessName: s.business_name,
          address: s.address ?? '',
          contactPhone: s.contact_phone ?? '',
          contactEmail: s.contact_email ?? '',
          numberingPrefix: s.numbering_prefix,
          receiptHeader: s.receipt_header ?? '',
          receiptFooter: s.receipt_footer ?? '',
          loyaltyEarnRate: s.loyalty_earn_rate,
          loyaltyRedemptionValue: s.loyalty_redemption_value,
        }),
      )
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load settings'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.tenantId])

  async function onSubmit(values: SettingsFormValues) {
    if (!profile) return
    setSubmitting(true)
    try {
      await updateSettings(profile.tenantId, {
        business_name: values.businessName,
        address: values.address || null,
        contact_phone: values.contactPhone || null,
        contact_email: values.contactEmail || null,
        numbering_prefix: values.numberingPrefix,
        receipt_header: values.receiptHeader || null,
        receipt_footer: values.receiptFooter || null,
        loyalty_earn_rate: values.loyaltyEarnRate,
        loyalty_redemption_value: values.loyaltyRedemptionValue,
      })
      toast.success('Settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading…</p>
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground">Business info used on receipts and throughout the app.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Business info</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="businessName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Business name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="numberingPrefix"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ticket/receipt number prefix</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="CW" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Address</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="contactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact phone</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="contactEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact email</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="receiptHeader"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Receipt header</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Shown at the top of every receipt" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="receiptFooter"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Receipt footer</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="e.g. Thank you!" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="loyaltyEarnRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Loyalty points earned per ₱1 spent</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.0001" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="loyaltyRedemptionValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Peso value per point redeemed</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.0001" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button type="submit" disabled={submitting} className="w-fit">
                Save settings
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
