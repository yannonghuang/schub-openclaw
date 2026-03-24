function InputField({ label, name, type, icon, register, errors }: any) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <div className="relative">
        <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500">
          {icon}
        </span>
        <input
          type={type}
          {...register(name, { required: true })}
          className={`w-full border p-2 pl-10 rounded ${
            errors[name] ? "border-red-500" : ""
          }`}
        />
      </div>
      {errors[name] && (
        <p className="text-red-500 text-sm mt-1">This field is required</p>
      )}
    </div>
  );
}
