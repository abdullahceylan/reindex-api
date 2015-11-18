import invariantFunction from 'invariant';
import { chain, groupBy, isEqual, isPlainObject, isString, uniq } from 'lodash';

import getInterfaceDefaultFields
  from '../../graphQL/builtins/InterfaceDefaultFields';
import getPluralName from '../../graphQL/utilities/getPluralName';
import ScalarTypes from '../../graphQL/builtins/ScalarTypes';
import getTypeDefaultFields from '../../graphQL/builtins/TypeDefaultFields';
import { getName, byName } from './utilities';

const InterfaceDefaultFields = getInterfaceDefaultFields();
const TypeDefaultFields = getTypeDefaultFields();

export default function validateSchema(
  { types },
  interfaces,
  requiredTypes = []
) {
  const errors = [];
  function invariant(...args) {
    try {
      invariantFunction(...args);
    } catch (e) {
      errors.push(e.toString().replace(
        /Invariant Violation: /,
        ''
      ));
    }
  }

  function getDuplicateSummary(iteratee, property) {
    return chain(groupBy(types, iteratee))
      .filter((values) => values.length > 1)
      .map((values) =>
        `${values.length} types with ${property} "${iteratee(values[0])}"`
      )
      .value()
      .join(', ');
  }

  if (uniq(types, getName).length !== types.length) {
    const summary = getDuplicateSummary(getName, 'name');
    invariant(false, 'Expected type names to be unique. Found %s', summary);
  }

  if (errors.length > 0) {
    return errors;
  }

  if (uniq(types, getPluralName).length !== types.length) {
    const summary = getDuplicateSummary(getPluralName, 'plural name');
    invariant(false, 'Expected plural names of types to be unique. Found %s',
      summary,
    );
  }

  if (errors.length > 0) {
    return errors;
  }

  const typeNames = types.map(getName);
  for (const requiredType of requiredTypes) {
    invariant(
      typeNames.includes(requiredType),
      'Expected %s type to be present.',
      requiredType
    );
  }

  if (errors.length > 0) {
    return errors;
  }

  const typesByName = byName(types);
  types.forEach((type) =>
    validateType(type, typesByName, interfaces, invariant)
  );

  if (errors.length > 0) {
    return errors;
  }

  for (const type of types) {
    validateFields(type, invariant);
    if (errors.length > 0) {
      continue;
    }
    type.fields.forEach((field) => validateField(
      type, field, typesByName, invariant
    ));
  }

  return errors;
}

const TYPE_NAME_PATTERN = /^[A-Z][_0-9A-Za-z]*$/;

function validateType(type, typesByName, interfaces, invariant) {
  invariant(
    isString(type.name),
    'Expected `name` of a type to be a string. Found: %s',
    type.name,
  );
  ['name', 'pluralName'].forEach((property) => {
    const name = type[property];
    invariant(
      name == null || TYPE_NAME_PATTERN.test(name),
      'Expected `%s` of a type to be a string starting with a capital ' +
      'letter. Allowed characters are letters A-Z, a-z and underscore (_). ' +
      'Found: %s',
      property, name,
    );
    invariant(
      name == null || !name.startsWith('Reindex'),
      'Invalid `%s`: %s. Names that begin with "Reindex" are reserved ' +
      'for built-in types.',
      property, name,
    );
  });
  const pluralName = getPluralName(type);
  invariant(
    !typesByName[pluralName] || typesByName[pluralName] === type,
    '%s: Plural name "%s" conflicts with the name of type %s. ' +
    'Use the `pluralName` property to define a unique plural name.',
    type.name, pluralName, pluralName,
  );
  invariant(
    type.kind === 'OBJECT',
    '%s: Expected type `kind` to be "OBJECT".',
    type.name,
  );
  invariant(
    type.description == null || isString(type.description),
    '%s: Expected `description` to be undefined or a string.',
    type.name,
  );
  invariant(
    Array.isArray(type.interfaces) &&
    type.interfaces.every((name) => isString(name) && interfaces[name]),
    '%s: Expected `interfaces` to be an array of interface names. Found: %s',
    type.name,
    type.interfaces,
  );
  invariant(
    Array.isArray(type.fields) &&
    type.fields.every(isPlainObject),
    '%s: Expected `fields` to be an array of field objects.',
    type.name,
  );
  invariant(
    type.fields.length > 0,
    '%s: Expected `fields` to be an array with at least one element',
    type.name,
  );
  invariant(
    uniq(type.fields, 'name').length === type.fields.length,
    '%s: Expected field names to be unique within a type.',
    type.name,
  );

}

function validateFields(type, invariant) {
  // must have all fields of interfaces
  type.interfaces.forEach((interfaceName) => {
    for (const defaultField of InterfaceDefaultFields[interfaceName] || []) {
      invariant(
        type.fields.some((field) => isEqual(field, defaultField)),
        '%s.%s: Expected %s%sfield of type %s from interface %s',
        type.name, defaultField.name,
        defaultField.nonNull ? 'non-null ' : '',
        defaultField.unique ? 'unique ' : '',
        defaultField.type, interfaceName
      );
    }
  });
}

function validateField(type, field, typesByName, invariant) {
  invariant(
    isString(field.name),
    '%s: Expected field name to be a string.',
    type.name
  );
  invariant(
    field.description == null || isString(field.description),
    '%s.%s: Expected `description` to be undefined or string. Found %s.',
    type.name, field.name, field.description,
  );
  invariant(
    field.deprecationReason == null || isString(field.deprecationReason),
    '%s.%s: Expected `deprecationReason` to be undefined or string. Found %s.',
    type.name, field.name, field.deprecationReason,
  );

  invariant(
    isString(field.type),
    '%s.%s: Expected field type to be a string. Found: %s.',
    type.name, field.name, field.type
  );
  invariant(
    field.type in ScalarTypes ||
    field.type in typesByName ||
    field.type === 'Connection' ||
    field.type === 'List',
    '%s.%s: Expected `type` to be a valid scalar or object type. Found: %s.',
    type.name, field.name, field.type
  );

  // ofType
  if (field.type === 'Connection') {
    invariant(
      field.ofType in typesByName &&
      isNodeType(typesByName[field.ofType]),
      '%s.%s: Expected `ofType` of a connection field to be an object type ' +
      'that implements the Node interface. Found: %s.',
      type.name, field.name, field.ofType,
    );
  } else if (field.type === 'List') {
    invariant(
      field.ofType in ScalarTypes ||
      (field.ofType in typesByName && !isNodeType(typesByName[field.ofType])),
      '%s.%s: Expected `ofType` of a list field to be a scalar or non-Node ' +
      'object type. Found: %s.',
      type.name, field.name, field.ofType,
    );
  } else {
    invariant(
      field.ofType == null,
      '%s.%s: Expected `ofType` to be undefined for a field with non-wrapper ' +
      'type "%s". Found: %s.',
      type.name, field.name, field.type, field.ofType,
    );
  }

  // reverseName
  const ofType = field.type === 'Connection' ? field.ofType : field.type;
  if (ofType in typesByName && isNodeType(typesByName[ofType])) {
    validateReverseField(type, field, typesByName, invariant);
  }

  // only scalar uniques
  invariant(
    !field.unique || field.type in ScalarTypes,
    '%s.%s: Expected unique field to be a scalar type. Found: %s.',
    type.name, field.name, field.type
  );

  // no overriding default fields
  const typeFields = TypeDefaultFields[type.name];
  invariant(
    !typeFields ||
    typeFields.every((defaultField) => defaultField.name !== field.name),
    '%s.%s: Field name shadows a built-in field.',
    type.name, field.name,
  );
}

function validateReverseField(
  type,
  field,
  typesByName,
  invariant
) {
  let reverseType;
  let expectedFieldType;
  let expectedFieldOfType;
  if (field.type === 'Connection') {
    reverseType = field.ofType;
    expectedFieldType = type.name;
    expectedFieldOfType = null;
  } else {
    reverseType = field.type;
    expectedFieldType = 'Connection';
    expectedFieldOfType = type.name;
  }

  let reverseField;
  if (field.reverseName) {
    reverseField = typesByName[reverseType].fields.find(({ name }) =>
      name === field.reverseName
    );
  }
  invariant(
    reverseField,
    '%s.%s: Expected `reverseName` to be a name of a %s field in type %s. ' +
    'Found: %s.',
    type.name, field.name, expectedFieldType, reverseType, field.reverseName,
  );
  if (reverseField) {
    invariant(
      reverseField.reverseName === field.name,
      '%s.%s: Expected reverse field of %s.%s to have matching `reverseName` ' +
      '%s. Found: %s.',
      reverseType, reverseField.name, type.name, field.name, field.name,
      reverseField.reverseName,
    );
    invariant(
      reverseField.type === expectedFieldType,
      '%s.%s: Expected reverse field of %s.%s to have type %s. Found: %s.',
      reverseType, reverseField.name, type.name, field.name, expectedFieldType,
      reverseField.type,
    );
    if (expectedFieldOfType) {
      invariant(
        reverseField.ofType === expectedFieldOfType,
        '%s.%s: Expected reverse field of %s.%s to have ofType %s. Found: %s.',
        reverseType, reverseField.name, type.name, field.name,
        expectedFieldOfType, reverseField.ofType,
      );
    }
  }
}

function isNodeType(type) {
  return type.interfaces.includes('Node');
}
