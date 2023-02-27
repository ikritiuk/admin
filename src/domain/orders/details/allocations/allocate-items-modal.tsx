import React, { useEffect, useMemo } from "react"
import { LineItem, Order, ReservationItemDTO } from "@medusajs/medusa"
import FocusModal from "../../../../components/molecules/modal/focus-modal"
import Button from "../../../../components/fundamentals/button"
import CrossIcon from "../../../../components/fundamentals/icons/cross-icon"
import Select from "../../../../components/molecules/select/next-select/select"
import {
  useAdminCreateReservation,
  useAdminStockLocations,
  useAdminVariantsInventory,
} from "medusa-react"
import { Controller, useForm, useWatch } from "react-hook-form"
import Thumbnail from "../../../../components/atoms/thumbnail"
import InputField from "../../../../components/molecules/input"
import { NestedForm, nestedForm } from "../../../../utils/nested-form"
import { sum } from "lodash"
import clsx from "clsx"
import { getFulfillableQuantity } from "../create-fulfillment/item-table"

type AllocationModalFormData = {
  location?: { label: string; value: string }
  items: AllocationLineItemForm[]
}

type AllocateItemsModalProps = {
  order: Order
  reservationItemsMap: Record<string, ReservationItemDTO[]>
  close: () => void
}

const AllocateItemsModal: React.FC<AllocateItemsModalProps> = ({
  order,
  close,
  reservationItemsMap,
}) => {
  const { mutate: createReservation } = useAdminCreateReservation()

  const form = useForm<AllocationModalFormData>({
    defaultValues: {
      items: [],
    },
  })

  const { handleSubmit, control } = form

  const selectedLocation = useWatch({ control, name: "location" })

  // if not sales channel is present fetch all locations
  const stockLocationsFilter: { sales_channel_id?: string } = {}
  if (order.sales_channel_id) {
    stockLocationsFilter.sales_channel_id = order.sales_channel_id
  }

  const { stock_locations, isLoading } =
    useAdminStockLocations(stockLocationsFilter)

  const locationOptions = useMemo(() => {
    if (!stock_locations) {
      return []
    }
    return stock_locations.map((sl) => ({
      value: sl.id,
      label: sl.name,
    }))
  }, [stock_locations])

  const onSubmit = async (data: AllocationModalFormData) => {
    if (!data.location?.value) {
      return
    }

    await Promise.all(
      data.items.map(async (item) => {
        if (!item.quantity) {
          return
        }
        await createReservation({
          quantity: item.quantity,
          line_item_id: item.line_item_id,
          inventory_item_id: item.inventory_item_id,
          location_id: data.location!.value,
        })
      })
    )

    // TODO: handle errors and success
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <FocusModal>
        <FocusModal.Header>
          <div className="flex w-full justify-between px-8 medium:w-8/12">
            <Button size="small" variant="ghost" type="button" onClick={close}>
              <CrossIcon size={20} />
            </Button>
            <div className="flex gap-x-small">
              <Button
                size="small"
                variant="secondary"
                type="button"
                onClick={close}
              >
                Cancel
              </Button>
              <Button size="small" variant="primary" type="submit">
                Save allocation
              </Button>
            </div>
          </div>
        </FocusModal.Header>
        <FocusModal.Main className="medium:w-6/12">
          {isLoading || !stock_locations ? (
            <div>Loading...</div>
          ) : (
            <div className="mt-16 flex flex-col">
              <h1 className="inter-xlarge-semibold">Allocate order items</h1>
              <div className="mt-6 flex w-full items-center justify-between">
                <div>
                  <p className="inter-base-semibold">Location</p>
                  <p className="inter-base-regular">
                    Choose where you wish to allocate from
                  </p>
                </div>
                <div className="w-1/2">
                  <Controller
                    name="location"
                    control={control}
                    rules={{ required: true }}
                    render={({ field: { value, onChange } }) => (
                      <Select
                        value={value}
                        onChange={onChange}
                        options={locationOptions}
                      />
                    )}
                  />
                </div>
              </div>
              <div
                className={clsx(
                  "mt-8 flex w-full flex-col border-t border-grey-20",
                  {
                    "pointer-events-none opacity-50": !selectedLocation?.value,
                  }
                )}
              >
                <div>
                  <p className="inter-base-semibold mt-8">Items to allocate</p>
                  <p className="inter-base-regular">
                    Select the number of items that you wish to allocate.
                  </p>
                  {order.items?.map((item, i) => {
                    return (
                      <AllocationLineItem
                        form={nestedForm(form, `items.${i}` as "items.0")}
                        item={item}
                        key={i}
                        locationId={selectedLocation?.value}
                        reservedQuantity={sum(
                          reservationItemsMap[item.id]?.map(
                            (reservation) => reservation.quantity
                          ) || []
                        )}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </FocusModal.Main>
      </FocusModal>
    </form>
  )
}

export type AllocationLineItemForm = {
  inventory_item_id: string
  line_item_id: string
  quantity: number
}

export const AllocationLineItem: React.FC<{
  form: NestedForm<AllocationLineItemForm>
  item: LineItem
  locationId?: string
  reservedQuantity?: number
}> = ({ form, item, locationId, reservedQuantity }) => {
  const { variant, isLoading } = useAdminVariantsInventory(
    item.variant_id as string
  )

  const { register, path } = form

  form.setValue(path("line_item_id"), item.id)

  useEffect(() => {
    if (variant?.inventory) {
      form.setValue(path("inventory_item_id"), variant.inventory[0].id)
    }
  }, [variant, form, path])

  const getAvailableQuantities = (variant) => {
    if (isLoading || !locationId || !variant) {
      return {}
    }

    const { inventory } = variant

    const locationInventory = inventory[0].location_levels?.find(
      (inv) => inv.location_id === locationId
    )

    if (!locationInventory) {
      return {}
    }

    return {
      availableQuantity: locationInventory.available_quantity,
      inStockQuantity: locationInventory.stocked_quantity,
    }
  }
  const { availableQuantity, inStockQuantity } = getAvailableQuantities(variant)

  const lineItemReservationCapacity =
    getFulfillableQuantity(item) - (reservedQuantity || 0)

  const inventoryItemReservationCapacity =
    typeof availableQuantity === "number" ? availableQuantity : 0

  const maxReservation = Math.min(
    lineItemReservationCapacity,
    inventoryItemReservationCapacity
  )
  return (
    <div>
      <div className="mt-8 flex w-full items-center justify-between">
        <div className="flex gap-x-base">
          <Thumbnail size="medium" src={item.thumbnail} />
          <div className="text-grey-50">
            <p className="flex gap-x-2xsmall">
              <p className="inter-base-semibold text-grey-90">{item.title}</p>
              {`(${item.variant.sku})`}
            </p>
            <p className="inter-base-regular ">
              {item.variant.options?.map((option) => option.value) ||
                item.variant.title ||
                "-"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-x-large">
          <div className="inter-base-regular flex flex-col items-end whitespace-nowrap text-grey-50">
            <p>{availableQuantity || "N/A"} available</p>
            <p>({inStockQuantity || "N/A"} in stock)</p>
          </div>
          <InputField
            {...register(path(`quantity`), { valueAsNumber: true })}
            type="number"
            defaultValue={0}
            disabled={lineItemReservationCapacity === 0}
            min={0}
            max={maxReservation}
            suffix={
              <span className="flex">
                {"/"} <span className="ml-1">{maxReservation}</span>
              </span>
            }
          />
        </div>
      </div>
    </div>
  )
}

export default AllocateItemsModal