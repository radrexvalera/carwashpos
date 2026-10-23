import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { useTenant } from '@/app/TenantProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { getSettings, removeBusinessLogoFile, updateSettings, uploadBusinessLogo } from './api/settingsApi'

const MAX_LOGO_BYTES = 2 * 1024 * 1024
const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']

const settingsSchema = z.object({
  businessName: z.string().min(1, 'Business name is required'),
  address: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().optional(),
  numberingPrefix: z.string().min(1, 'Required').max(10),
  receiptHeader: z.string().optional(),
  receiptFooter: z.string().optional(),
  receiptPaperWidth: z.enum(['58mm', '80mm']),
})

type SettingsFormValues = z.infer<typeof settingsSchema>

export function SettingsPage() {
  const { profile } = useTenant()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

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
      receiptPaperWidth: '58mm',
    },
  })

  useEffect(() => {
    if (!profile) return
    getSettings(profile.tenantId)
      .then((s) => {
        form.reset({
          businessName: s.business_name,
          address: s.address ?? '',
          contactPhone: s.contact_phone ?? '',
          contactEmail: s.contact_email ?? '',
          numberingPrefix: s.numbering_prefix,
          receiptHeader: s.receipt_header ?? '',
          receiptFooter: s.receipt_footer ?? '',
          receiptPaperWidth: (s.receipt_paper_width as '58mm' | '80mm') ?? '58mm',
        })
        setLogoUrl(s.logo_url)
      })
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
        receipt_paper_width: values.receiptPaperWidth,
      })
      toast.success('Settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLogoFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !profile) return
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      toast.error('Logo must be a PNG, JPEG, or WEBP image')
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error('Logo must be 2MB or smaller')
      return
    }
    setUploadingLogo(true)
    try {
      const newUrl = await uploadBusinessLogo(profile.tenantId, file)
      await updateSettings(profile.tenantId, { logo_url: newUrl })
      const previousUrl = logoUrl
      setLogoUrl(newUrl)
      if (previousUrl) removeBusinessLogoFile(previousUrl)
      toast.success('Logo updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload logo')
    } finally {
      setUploadingLogo(false)
    }
  }

  async function handleRemoveLogo() {
    if (!profile || !logoUrl) return
    const previousUrl = logoUrl
    try {
      await updateSettings(profile.tenantId, { logo_url: null })
      setLogoUrl(null)
      removeBusinessLogoFile(previousUrl)
      toast.success('Logo removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove logo')
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
          <CardTitle>Business logo</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
            {logoUrl ? (
              <img src={logoUrl} alt="Business logo" className="h-full w-full object-contain" />
            ) : (
              <span className="text-center text-xs text-muted-foreground">No logo</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleLogoFileChange}
            />
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={uploadingLogo} onClick={() => logoInputRef.current?.click()}>
                {uploadingLogo ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
              </Button>
              {logoUrl && (
                <Button type="button" variant="ghost" onClick={handleRemoveLogo}>
                  Remove
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              PNG, JPEG, or WEBP, up to 2MB. Shown in the app header and on printed receipts and payslips.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card id="tour-settings-business">
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
              <FormField
                control={form.control}
                name="receiptPaperWidth"
                render={({ field }) => (
                  <FormItem className="max-w-xs">
                    <FormLabel>Receipt printer paper width</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="58mm">58mm</SelectItem>
                        <SelectItem value="80mm">80mm</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
